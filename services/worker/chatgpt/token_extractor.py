"""
Token 提取引擎 - 从 extract_all_tokens.py 提取的核心逻辑
用于 OAuth 登录并提取所有 workspace 的 tokens
"""

import time
import json
import re
import secrets
import logging
import os
from datetime import datetime
from html import unescape
from typing import Optional, Dict, List, Any, Callable
from urllib.parse import urlencode

from chatgpt.auth_utils import (
    build_workspace_token_result,
    decode_oauth_session_cookie_value,
    decode_jwt_payload,
    extract_code_from_url,
    extract_verification_code,
    find_workspace,
    generate_pkce,
    make_trace_headers,
    workspace_display_name,
)
from chatgpt.models import TokenExtractionResult
from chatgpt.sentinel_token import build_sentinel_token
from integrations.moemail_webhook_cache import pop_verification_code

logger = logging.getLogger(__name__)


def _safe_json_loads(raw: str):
    try:
        return json.loads(raw)
    except Exception:
        try:
            cleaned = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", raw or "")
            return json.loads(cleaned)
        except Exception:
            return {}


def _parse_timestamp(value):
    if value is None:
        return None
    if isinstance(value, (int, float)):
        ts = float(value)
        return ts / 1000 if ts > 1_000_000_000_000 else ts

    text = str(value).strip()
    if not text:
        return None
    if text.isdigit():
        ts = float(text)
        return ts / 1000 if ts > 1_000_000_000_000 else ts

    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def _get_message_timestamp(message: dict):
    if not isinstance(message, dict):
        return None
    for field in (
        "received_at",
        "receivedAt",
        "received_time",
        "receivedTime",
        "date",
        "created_at",
        "createdAt",
        "updated_at",
        "updatedAt",
        "timestamp",
    ):
        ts = _parse_timestamp(message.get(field))
        if ts is not None:
            return ts
    return None


def _get_message_id(message: dict) -> str:
    if not isinstance(message, dict):
        return ""
    for field in ("id", "messageId", "message_id", "_id"):
        value = message.get(field)
        if value:
            return str(value).strip()
    return ""


def _build_searchable_text(*parts):
    raw = " ".join(str(part or "") for part in parts if part)
    if not raw:
        return ""

    text = unescape(raw)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _generate_pkce():
    """生成 PKCE code_verifier 和 code_challenge"""
    return generate_pkce()


def _extract_code_from_url(url: str) -> Optional[str]:
    """从 URL 中提取 authorization code"""
    return extract_code_from_url(url)


def _make_trace_headers():
    """生成追踪头"""
    return make_trace_headers()


class TokenExtractor:
    """Token 提取器"""

    def __init__(
        self,
        email: str,
        password: str,
        moemail_api: str,
        moemail_api_key: str,
        moemail_email_id: str,
        proxy: Optional[str] = None,
        oauth_issuer: str = "https://auth.openai.com",
        oauth_client_id: str = "app_EMoamEEZ73f0CkXaXp7hrann",
        oauth_redirect_uri: str = "http://localhost:1455/auth/callback",
        existing_workspace_tokens: Optional[List[Dict[str, Any]]] = None,
        workspace_token_callback: Optional[Callable[[List[Dict[str, Any]]], None]] = None,
    ):
        self.email = email
        self.password = password
        self.moemail_api = moemail_api.rstrip("/")
        self.moemail_api_key = moemail_api_key
        self.moemail_email_id = moemail_email_id
        self.proxy = proxy
        self.oauth_issuer = oauth_issuer.rstrip("/")
        self.oauth_client_id = oauth_client_id
        self.oauth_redirect_uri = oauth_redirect_uri
        self.workspace_login_delay_seconds = int(os.getenv("CHATGPT_WORKSPACE_LOGIN_DELAY_SECONDS", "5"))
        self.workspace_token_callback = workspace_token_callback
        self.existing_workspace_tokens = [
            token for token in (existing_workspace_tokens or []) if isinstance(token, dict)
        ]
        self.existing_workspace_token_map = {
            token.get("workspace_id"): token
            for token in self.existing_workspace_tokens
            if token.get("workspace_id") and token.get("access_token")
        }

        # 初始化 session
        from curl_cffi import requests as curl_requests
        import uuid
        self.device_id = str(uuid.uuid4())
        self.impersonate = "chrome131"
        self.ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
        self.sec_ch_ua = '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"'
        self.session = None
        self._curl_requests = curl_requests
        self._reset_session()

    def _reset_session(self):
        """为一次独立 OAuth 登录创建新的浏览器 session。"""
        import uuid
        self.device_id = str(uuid.uuid4())
        self.session = self._curl_requests.Session(impersonate=self.impersonate)
        if self.proxy:
            self.session.proxies = {"http": self.proxy, "https": self.proxy}

        self.session.headers.update({
            "User-Agent": self.ua,
            "sec-ch-ua": self.sec_ch_ua,
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"Windows"',
        })

        self.session.cookies.set("oai-did", self.device_id, domain=".auth.openai.com")
        self.session.cookies.set("oai-did", self.device_id, domain="auth.openai.com")
        self.session.cookies.set("oai-did", self.device_id, domain=".chatgpt.com")
        self.session.cookies.set("oai-did", self.device_id, domain="chatgpt.com")

    def _log(self, message: str):
        """记录日志"""
        logger.info(f"[TokenExtractor] {message}")

    def _oauth_json_headers(self, referer: str) -> dict:
        headers = {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Origin": self.oauth_issuer,
            "Referer": referer,
            "User-Agent": self.ua,
            "oai-device-id": self.device_id,
        }
        headers.update(_make_trace_headers())
        return headers

    def _build_sentinel_token(self, flow: str) -> Optional[str]:
        token = build_sentinel_token(
            self.session,
            self.device_id,
            flow=flow,
            user_agent=self.ua,
            sec_ch_ua=self.sec_ch_ua,
            impersonate=self.impersonate,
        )
        if not token:
            self._log(f"{flow} sentinel token 获取失败")
        return token

    def _get_moemail_session(self):
        """创建 MoeMail session"""
        from curl_cffi import requests as curl_requests
        session = curl_requests.Session(impersonate="chrome131")
        session.headers.update({
            "User-Agent": self.ua,
            "Accept": "application/json",
            "Content-Type": "application/json",
        })
        if self.proxy:
            session.proxies = {"http": self.proxy, "https": self.proxy}
        return session

    def _moemail_headers(self) -> Dict[str, str]:
        headers = {
            "Cache-Control": "no-cache",
            "Pragma": "no-cache",
        }
        if self.moemail_api_key:
            headers["X-API-Key"] = self.moemail_api_key
        return headers

    def _moemail_json(self, resp) -> Dict[str, Any]:
        try:
            data = resp.json()
        except Exception:
            data = _safe_json_loads(getattr(resp, "text", "") or "")
        return data if isinstance(data, dict) else {}

    def _moemail_page_messages(self, data: Dict[str, Any]) -> List[Dict[str, Any]]:
        if not isinstance(data, dict):
            return []

        candidates = [
            data.get("messages"),
            data.get("items"),
            data.get("results"),
            data.get("data"),
        ]
        nested_data = data.get("data")
        if isinstance(nested_data, dict):
            candidates.extend([
                nested_data.get("messages"),
                nested_data.get("items"),
                nested_data.get("results"),
            ])

        for value in candidates:
            if isinstance(value, list):
                return [item for item in value if isinstance(item, dict)]
        return []

    def _list_moemail_messages(self, session, headers: Dict[str, str], max_pages: int = 3) -> List[Dict[str, Any]]:
        messages: List[Dict[str, Any]] = []
        cursor = None

        for _ in range(max_pages):
            url = f"{self.moemail_api}/api/emails/{self.moemail_email_id}?_t={int(time.time() * 1000)}"
            if cursor:
                url += f"&cursor={cursor}"

            resp = session.get(url, headers=headers, timeout=15)
            if resp.status_code != 200:
                self._log(f"MoeMail 邮件列表失败: {resp.status_code} {getattr(resp, 'text', '')[:120]}")
                break

            data = self._moemail_json(resp)
            page_messages = self._moemail_page_messages(data)

            messages.extend(page_messages)
            cursor = data.get("nextCursor")
            if not cursor and isinstance(data.get("data"), dict):
                cursor = data["data"].get("nextCursor")
            if not cursor or not page_messages:
                break

        recent_cutoff = time.time() - 600
        filtered = []
        for message in messages:
            msg_time = _get_message_timestamp(message)
            if msg_time is not None and msg_time < recent_cutoff:
                continue
            filtered.append(message)

        filtered.sort(key=lambda item: _get_message_timestamp(item) or 0, reverse=True)
        return filtered

    def _fetch_moemail_message_detail(self, session, headers: Dict[str, str], message_id: str) -> Dict[str, Any]:
        if not message_id:
            return {}

        resp = session.get(
            f"{self.moemail_api}/api/emails/{self.moemail_email_id}/{message_id}",
            headers=headers,
            timeout=15,
        )
        if resp.status_code != 200:
            return {}

        data = self._moemail_json(resp)
        if isinstance(data.get("message"), dict):
            return data.get("message") or {}
        return data

    def _moemail_message_content(self, message: Dict[str, Any], detail: Dict[str, Any]) -> str:
        merged: Dict[str, Any] = {}
        if isinstance(message, dict):
            merged.update(message)
        if isinstance(detail, dict):
            merged.update(detail)

        return _build_searchable_text(
            merged.get("subject"),
            merged.get("content"),
            merged.get("text"),
            merged.get("body"),
            merged.get("bodyText"),
            merged.get("bodyHtml"),
            merged.get("html"),
            merged.get("snippet"),
            merged.get("preview"),
            merged.get("raw"),
            merged.get("data"),
        )

    def _fetch_otp_from_moemail(
        self,
        timeout: int = 120,
        exclude_codes: Optional[set] = None,
    ) -> Optional[str]:
        """从 MoeMail 获取 OTP 验证码"""
        self._log(f"等待 MoeMail 验证码 (邮箱ID: {self.moemail_email_id})")

        session = self._get_moemail_session()
        headers = self._moemail_headers()

        start_time = time.time()
        exclude_codes = exclude_codes or set()

        while time.time() - start_time < timeout:
            try:
                webhook_code = pop_verification_code(self.moemail_email_id)
                if webhook_code and webhook_code not in exclude_codes:
                    self._log(f"收到 Webhook 验证码: {webhook_code}")
                    return webhook_code

                messages = self._list_moemail_messages(session, headers, max_pages=3)
                for msg in messages[:12]:
                    msg_id = _get_message_id(msg)
                    detail = self._fetch_moemail_message_detail(session, headers, msg_id) if msg_id else {}
                    content = self._moemail_message_content(msg, detail)
                    code = self._extract_verification_code(content)
                    if code and code not in exclude_codes:
                        self._log(f"收到验证码: {code}")
                        return code

                time.sleep(2)

            except Exception as e:
                self._log(f"获取邮件失败: {e}")
                time.sleep(2)

        return None

    def _send_email_otp(self, referer: Optional[str] = None) -> bool:
        """触发重新发送邮箱验证码。"""
        try:
            self._log("触发重发验证码")
            resp = self.session.get(
                f"{self.oauth_issuer}/api/accounts/email-otp/send",
                headers={
                    "Accept": "application/json, text/plain, */*",
                    "Referer": referer or f"{self.oauth_issuer}/email-verification",
                    "User-Agent": self.ua,
                    "oai-device-id": self.device_id,
                },
                allow_redirects=True,
                timeout=30,
            )
            if resp.status_code != 200:
                self._log(f"重发验证码失败: {resp.status_code} {getattr(resp, 'text', '')[:120]}")
                return False
            self._log("重发验证码成功")
            return True
        except Exception as exc:
            self._log(f"重发验证码异常: {exc}")
            return False

    def _validate_otp_with_retry(self, headers: Dict[str, str], referer: str) -> Dict[str, Any]:
        """获取并提交 OTP，旧码失效时触发一次重发后继续等待。"""
        failed_codes = set()
        resend_attempted = False
        deadline = time.time() + 180

        while time.time() < deadline:
            remaining = max(10, int(deadline - time.time()))
            otp_code = self._fetch_otp_from_moemail(
                timeout=min(60, remaining),
                exclude_codes=failed_codes,
            )
            if not otp_code:
                if not resend_attempted:
                    resend_attempted = True
                    self._send_email_otp(referer=referer)
                    continue
                return {"success": False, "error_message": "未收到验证码"}

            self._log(f"提交验证码: {otp_code}")
            otp_resp = self.session.post(
                f"{self.oauth_issuer}/api/accounts/email-otp/validate",
                json={"code": otp_code},
                headers=headers,
                timeout=30,
            )

            if otp_resp.status_code == 200:
                try:
                    otp_data = otp_resp.json()
                except Exception:
                    otp_data = {}
                return {"success": True, "data": otp_data}

            failed_codes.add(otp_code)
            self._log(f"验证码验证失败: {otp_resp.status_code} {getattr(otp_resp, 'text', '')[:120]}")
            if not resend_attempted:
                resend_attempted = True
                self._send_email_otp(referer=referer)

        return {"success": False, "error_message": "验证码验证超时"}

    def _extract_verification_code(self, content: str) -> Optional[str]:
        """从邮件内容提取验证码"""
        return extract_verification_code(content)

    def _existing_workspace_token(self, workspace_id: Optional[str]) -> Optional[Dict[str, Any]]:
        if not workspace_id:
            return None
        existing = self.existing_workspace_token_map.get(workspace_id)
        return dict(existing) if existing else None

    def _reuse_workspace_token(self, existing: Dict[str, Any], workspace: Dict[str, Any]) -> Dict[str, Any]:
        token = dict(existing)
        workspace_id = token.get("workspace_id") or (workspace or {}).get("id")
        if workspace_id:
            token["workspace_id"] = workspace_id
        token["workspace_name"] = self._workspace_display_name(workspace) or token.get("workspace_name")
        if (workspace or {}).get("kind"):
            token["kind"] = workspace.get("kind")
        return token

    def _can_reuse_workspace_token(self, existing: Optional[Dict[str, Any]], workspace: Dict[str, Any]) -> bool:
        if not existing:
            return False

        kind = str((workspace or {}).get("kind") or existing.get("kind") or "").lower()
        plan_type = str(existing.get("plan_type") or "").lower()
        if kind == "personal" and plan_type == "free":
            self._log("个人 workspace 已保存 token 仍是 Free，本次强制刷新个人订阅")
            return False

        return bool(existing.get("access_token"))

    def _is_oauth_state_error(self, error_message: str) -> bool:
        text = (error_message or "").lower()
        return (
            "invalid_state" in text
            or "invalid client" in text
            or "invalid_auth_step" in text
        )

    def _is_rate_limit_error(self, error_message: str) -> bool:
        text = (error_message or "").lower()
        return "429" in text or "rate limit" in text or "rate_limit" in text

    def _sort_workspace_tokens(
        self,
        tokens: List[Dict[str, Any]],
        ordered_workspaces: List[Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        workspace_order = {
            (workspace or {}).get("id"): index
            for index, workspace in enumerate(ordered_workspaces)
            if (workspace or {}).get("id")
        }
        return sorted(tokens, key=lambda item: workspace_order.get(item.get("workspace_id"), len(workspace_order)))

    def _notify_workspace_token_callback(
        self,
        tokens: List[Dict[str, Any]],
        ordered_workspaces: List[Dict[str, Any]],
    ) -> None:
        if not self.workspace_token_callback:
            return
        try:
            self.workspace_token_callback(self._sort_workspace_tokens(list(tokens), ordered_workspaces))
        except Exception as exc:
            self._log(f"保存已提取 workspace token 失败，继续提取: {exc}")

    def _perform_oauth_login_with_retry(
        self,
        max_attempts: int = 2,
        **kwargs,
    ) -> Dict[str, Any]:
        last_result: Dict[str, Any] = {"success": False, "error_message": "OAuth 登录失败"}
        for attempt in range(1, max_attempts + 1):
            if attempt > 1:
                self._reset_session()

            result = self._perform_oauth_login(**kwargs)
            last_result = result
            if result.get("success"):
                return result

            error_message = str(result.get("error_message") or "")
            if self._is_rate_limit_error(error_message):
                return result

            if not self._is_oauth_state_error(error_message):
                return result

            if attempt < max_attempts:
                self._log(f"OAuth state 失效，完整重建 session 后重试登录 ({attempt + 1}/{max_attempts})")
                time.sleep(3)

        return last_result

    def extract_tokens(self) -> TokenExtractionResult:
        """执行 OAuth 登录，并为每个 workspace 单独提取绑定 token。"""
        try:
            self._log("开始提取所有 workspace 的独立 tokens")

            first_login = self._perform_oauth_login_with_retry(
                prefer_personal=True,
                prefer_missing_workspace_token=True,
            )
            if not first_login.get("success"):
                return TokenExtractionResult(
                    success=False,
                    email=self.email,
                    error_message=first_login.get("error_message", "首次 OAuth 登录失败")
                )

            session_data = first_login.get("session_data") or {}
            raw_workspaces = session_data.get("workspaces") or []
            if not raw_workspaces:
                return TokenExtractionResult(
                    success=False,
                    email=self.email,
                    error_message="OAuth session 中未找到 workspace 列表"
                )

            personal_workspace = None
            other_workspaces = []
            for workspace in raw_workspaces:
                if (workspace or {}).get("kind") == "personal" and personal_workspace is None:
                    personal_workspace = workspace
                else:
                    other_workspaces.append(workspace)

            ordered_workspaces = []
            if personal_workspace:
                ordered_workspaces.append(personal_workspace)
            ordered_workspaces.extend(other_workspaces)

            results = []
            used_workspace_ids = set()

            first_login_token = self._build_workspace_token_result(
                first_login.get("token_data") or {},
                ordered_workspaces,
            )
            first_workspace_id = (first_login_token or {}).get("workspace_id")
            first_workspace = self._find_workspace(ordered_workspaces, first_workspace_id) or personal_workspace or (
                ordered_workspaces[0] if ordered_workspaces else {}
            )
            first_workspace_id = first_workspace_id or (first_workspace or {}).get("id")
            existing_first_token = self._existing_workspace_token(first_workspace_id)
            can_reuse_first_token = self._can_reuse_workspace_token(existing_first_token, first_workspace)
            if can_reuse_first_token:
                first_workspace_token = self._reuse_workspace_token(existing_first_token, first_workspace)
                self._log(
                    f"复用已保存 workspace token: "
                    f"{first_workspace_token.get('workspace_name') or first_workspace_token.get('workspace_id')}"
                )
            else:
                first_workspace_token = first_login_token
            if first_workspace_token:
                results.append(first_workspace_token)
                used_workspace_ids.add(first_workspace_token.get("workspace_id"))
                if not can_reuse_first_token:
                    self._notify_workspace_token_callback(results, ordered_workspaces)
                    self._log(
                        f"已保存首次登录 token: "
                        f"{first_workspace_token.get('workspace_name') or first_workspace_token.get('workspace_id')}"
                    )

            for index, workspace in enumerate(ordered_workspaces, 1):
                workspace_id = (workspace or {}).get("id")
                if not workspace_id or workspace_id in used_workspace_ids:
                    continue

                workspace_name = self._workspace_display_name(workspace)
                existing_token = self._existing_workspace_token(workspace_id)
                if self._can_reuse_workspace_token(existing_token, workspace):
                    reused_token = self._reuse_workspace_token(existing_token, workspace)
                    results.append(reused_token)
                    used_workspace_ids.add(workspace_id)
                    self._log(f"[{index}/{len(ordered_workspaces)}] 复用已保存 workspace token: {workspace_name} ({workspace_id})")
                    continue

                if results:
                    self._log(f"等待 {self.workspace_login_delay_seconds} 秒后登录下一个 workspace")
                    time.sleep(self.workspace_login_delay_seconds)

                self._log(f"[{index}/{len(ordered_workspaces)}] 单独登录 workspace: {workspace_name} ({workspace_id})")

                self._reset_session()
                login_result = self._perform_oauth_login_with_retry(
                    target_workspace_id=workspace_id,
                )
                if not login_result.get("success"):
                    error_message = login_result.get("error_message", "未知错误")
                    self._log(
                        f"workspace token 提取失败: {workspace_name} "
                        f"- {error_message}"
                    )
                    if self._is_rate_limit_error(str(error_message)):
                        self._log("检测到 OAuth 限流，本轮停止继续登录剩余 workspace，下次刷新会继续补齐")
                        break
                    continue

                workspace_token = self._build_workspace_token_result(
                    login_result.get("token_data") or {},
                    ordered_workspaces,
                    expected_workspace_id=workspace_id,
                )
                if workspace_token:
                    results.append(workspace_token)
                    used_workspace_ids.add(workspace_token.get("workspace_id"))
                    self._notify_workspace_token_callback(results, ordered_workspaces)

            if not results:
                return TokenExtractionResult(
                    success=False,
                    email=self.email,
                    error_message="未获取到有效 workspace tokens"
                )

            results = self._sort_workspace_tokens(results, ordered_workspaces)

            self._log(f"成功提取 {len(results)} 个 workspace 的独立 tokens")
            return TokenExtractionResult(success=True, email=self.email, workspaces=results)

        except Exception as e:
            self._log(f"提取失败: {e}")
            import traceback
            traceback.print_exc()
            return TokenExtractionResult(success=False, email=self.email, error_message=str(e))

    def _perform_oauth_login(
        self,
        target_workspace_id: Optional[str] = None,
        prefer_personal: bool = False,
        prefer_missing_workspace_token: bool = False,
    ) -> Dict[str, Any]:
        """完成一次 OAuth 登录，返回当前选择 workspace 绑定的 token。"""
        try:
            self._log("开始 OAuth 登录流程")

            # 生成 PKCE
            code_verifier, code_challenge = _generate_pkce()
            state = secrets.token_urlsafe(24)

            # 构建 authorize URL
            authorize_params = {
                "response_type": "code",
                "client_id": self.oauth_client_id,
                "redirect_uri": self.oauth_redirect_uri,
                "scope": "openid profile email offline_access",
                "code_challenge": code_challenge,
                "code_challenge_method": "S256",
                "state": state,
            }
            authorize_url = f"{self.oauth_issuer}/oauth/authorize?{urlencode(authorize_params)}"

            # 初始化 OAuth 会话。新版 auth 流程需要先拿 login_session。
            self._log("访问 authorize URL")
            auth_resp = self.session.get(
                authorize_url,
                headers={
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "Referer": "https://chatgpt.com/",
                    "Upgrade-Insecure-Requests": "1",
                    "User-Agent": self.ua,
                },
                allow_redirects=True,
                timeout=30,
            )
            authorize_final_url = str(auth_resp.url)
            has_login_session = any(
                getattr(cookie, "name", "") == "login_session"
                for cookie in getattr(self.session.cookies, "jar", [])
            )

            if not has_login_session:
                self._log("未获取 login_session，尝试 oauth2 auth 入口")
                oauth2_resp = self.session.get(
                    f"{self.oauth_issuer}/api/oauth/oauth2/auth",
                    params=authorize_params,
                    headers={
                        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                        "Referer": authorize_url,
                        "Upgrade-Insecure-Requests": "1",
                        "User-Agent": self.ua,
                    },
                    allow_redirects=True,
                    timeout=30,
                )
                authorize_final_url = str(oauth2_resp.url)

            # 提交邮箱
            self._log(f"提交邮箱: {self.email}")
            sentinel_authorize = self._build_sentinel_token("authorize_continue")
            if not sentinel_authorize:
                return {"success": False, "error_message": "提交邮箱失败: sentinel token 获取失败"}

            continue_referer = (
                authorize_final_url
                if authorize_final_url.startswith(self.oauth_issuer)
                else f"{self.oauth_issuer}/log-in"
            )
            headers = self._oauth_json_headers(continue_referer)
            headers["openai-sentinel-token"] = sentinel_authorize
            email_resp = self.session.post(
                f"{self.oauth_issuer}/api/accounts/authorize/continue",
                json={"username": {"kind": "email", "value": self.email}},
                headers=headers,
                timeout=30,
                allow_redirects=False,
            )

            if email_resp.status_code in (400, 409) and (
                "invalid_auth_step" in (email_resp.text or "")
                or "invalid_state" in (email_resp.text or "")
            ):
                self._log("邮箱提交状态失效，重新初始化 OAuth 会话后重试")
                retry_resp = self.session.get(
                    authorize_url,
                    headers={
                        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                        "Referer": "https://chatgpt.com/",
                        "Upgrade-Insecure-Requests": "1",
                        "User-Agent": self.ua,
                    },
                    allow_redirects=True,
                    timeout=30,
                )
                retry_final_url = str(retry_resp.url)
                has_login_session = any(
                    getattr(cookie, "name", "") == "login_session"
                    for cookie in getattr(self.session.cookies, "jar", [])
                )
                if not has_login_session:
                    retry_oauth2_resp = self.session.get(
                        f"{self.oauth_issuer}/api/oauth/oauth2/auth",
                        params=authorize_params,
                        headers={
                            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                            "Referer": authorize_url,
                            "Upgrade-Insecure-Requests": "1",
                            "User-Agent": self.ua,
                        },
                        allow_redirects=True,
                        timeout=30,
                    )
                    retry_final_url = str(retry_oauth2_resp.url)

                sentinel_authorize = self._build_sentinel_token("authorize_continue")
                if not sentinel_authorize:
                    return {"success": False, "error_message": "提交邮箱失败: sentinel token 获取失败"}
                retry_referer = (
                    retry_final_url
                    if retry_final_url.startswith(self.oauth_issuer)
                    else f"{self.oauth_issuer}/log-in"
                )
                headers = self._oauth_json_headers(retry_referer)
                headers["openai-sentinel-token"] = sentinel_authorize
                email_resp = self.session.post(
                    f"{self.oauth_issuer}/api/accounts/authorize/continue",
                    json={"username": {"kind": "email", "value": self.email}},
                    headers=headers,
                    timeout=30,
                    allow_redirects=False,
                )

            if email_resp.status_code != 200:
                if email_resp.status_code in (400, 409) and (
                    "invalid_auth_step" in (email_resp.text or "")
                    or "invalid_state" in (email_resp.text or "")
                    or "Invalid client" in (email_resp.text or "")
                ):
                    return {
                        "success": False,
                        "error_message": f"OAuth state 失效: {email_resp.status_code} {email_resp.text[:160]}",
                    }
                return {
                    "success": False,
                    "error_message": f"提交邮箱失败: {email_resp.status_code} {email_resp.text[:160]}",
                }

            email_data = email_resp.json()
            continue_url = email_data.get("continue_url", "")
            page_type = (email_data.get("page") or {}).get("type", "")
            self._log(f"邮箱提交成功: page={page_type or '-'}")

            # 提交密码
            self._log("提交密码")
            sentinel_password = self._build_sentinel_token("password_verify")
            if not sentinel_password:
                return {"success": False, "error_message": "密码验证失败: sentinel token 获取失败"}

            headers = self._oauth_json_headers(f"{self.oauth_issuer}/log-in/password")
            headers["openai-sentinel-token"] = sentinel_password
            password_resp = self.session.post(
                f"{self.oauth_issuer}/api/accounts/password/verify",
                json={"password": self.password} if self.password else {},
                headers=headers,
                timeout=30,
                allow_redirects=False,
            )

            if password_resp.status_code != 200:
                return {
                    "success": False,
                    "error_message": f"密码验证失败: {password_resp.status_code} {password_resp.text[:160]}",
                }

            password_data = password_resp.json()
            continue_url = password_data.get("continue_url", "") or continue_url
            page_type = (password_data.get("page") or {}).get("type", "") or page_type
            self._log(f"密码验证成功: page={page_type or '-'}")

            # 处理 OTP 验证
            if page_type in {"email_otp", "email_otp_verification"} or "email-otp" in continue_url or "email-verification" in continue_url:
                self._log("需要 OTP 验证")

                otp_result = self._validate_otp_with_retry(
                    headers=headers,
                    referer=f"{self.oauth_issuer}/email-verification",
                )
                if not otp_result.get("success"):
                    return {
                        "success": False,
                        "error_message": otp_result.get("error_message") or "验证码验证失败",
                    }

                otp_data = otp_result.get("data") or {}
                continue_url = otp_data.get("continue_url", "") or continue_url
                page_type = (otp_data.get("page") or {}).get("type", "") or page_type

            # 获取 authorization code
            self._log("获取 authorization code")
            code = self._resolve_authorization_code(
                continue_url,
                page_type,
                target_workspace_id=target_workspace_id,
                prefer_personal=prefer_personal,
                prefer_missing_workspace_token=prefer_missing_workspace_token,
            )
            if not code:
                return {"success": False, "error_message": "未能获取 authorization code"}

            # 交换 token
            self._log("交换 access token")
            token_resp = self.session.post(
                f"{self.oauth_issuer}/oauth/token",
                headers={"Content-Type": "application/x-www-form-urlencoded", "User-Agent": self.ua},
                data={
                    "grant_type": "authorization_code",
                    "code": code,
                    "redirect_uri": self.oauth_redirect_uri,
                    "client_id": self.oauth_client_id,
                    "code_verifier": code_verifier,
                },
                timeout=60,
            )

            if token_resp.status_code != 200:
                return {"success": False, "error_message": f"Token 交换失败: {token_resp.status_code}"}

            token_data = token_resp.json()
            access_token = token_data.get("access_token")
            if not access_token:
                return {"success": False, "error_message": "Token 响应缺少 access_token"}

            return {
                "success": True,
                "token_data": token_data,
                "session_data": self._decode_oauth_session_cookie() or {},
            }

        except Exception as e:
            self._log(f"OAuth 登录失败: {e}")
            import traceback
            traceback.print_exc()
            return {"success": False, "error_message": str(e)}

    def _decode_access_token_payload(self, access_token: str) -> Dict[str, Any]:
        payload = decode_jwt_payload(access_token)
        if not payload and access_token:
            self._log("解析 access_token 失败")
        return payload

    def _workspace_display_name(self, workspace: Dict[str, Any]) -> str:
        return workspace_display_name(workspace)

    def _find_workspace(self, workspaces: List[Dict[str, Any]], workspace_id: Optional[str]) -> Optional[Dict[str, Any]]:
        return find_workspace(workspaces, workspace_id)

    def _build_workspace_token_result(
        self,
        token_data: Dict[str, Any],
        known_workspaces: List[Dict[str, Any]],
        expected_workspace_id: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        result = build_workspace_token_result(token_data, known_workspaces, expected_workspace_id)
        if result and expected_workspace_id and not result.get("matched"):
            self._log(f"警告: token 绑定 workspace {result.get('workspace_id')}，期望 {expected_workspace_id}")
        return result

    def _get_authorization_code(self, continue_url: str, headers: dict) -> Optional[str]:
        """获取 authorization code"""
        if not continue_url:
            return None

        if continue_url.startswith("/"):
            continue_url = f"{self.oauth_issuer}{continue_url}"

        # 检查 URL 中是否已有 code
        code = _extract_code_from_url(continue_url)
        if code:
            return code

        # 跟随重定向获取 code
        try:
            resp = self.session.get(
                continue_url,
                headers={
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "User-Agent": headers.get("User-Agent"),
                },
                allow_redirects=True,
                timeout=30,
            )

            # 检查最终 URL
            code = _extract_code_from_url(str(resp.url))
            if code:
                return code

            # 检查重定向历史
            for r in getattr(resp, "history", []) or []:
                loc = r.headers.get("Location", "")
                code = _extract_code_from_url(loc)
                if code:
                    return code

        except Exception as e:
            self._log(f"获取 code 失败: {e}")

        return None

    def _decode_oauth_session_cookie(self) -> Optional[dict]:
        cookie_items = list(getattr(self.session.cookies, "jar", []) or [])

        for cookie in cookie_items:
            name = getattr(cookie, "name", "") or ""
            if "oai-client-auth-session" not in name:
                continue

            raw_value = (getattr(cookie, "value", "") or "").strip()
            if not raw_value:
                continue

            data = decode_oauth_session_cookie_value(raw_value)
            if data:
                return data
        return None

    def _oauth_follow_for_code(self, start_url: str, referer: Optional[str] = None, max_hops: int = 16):
        headers = {
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Upgrade-Insecure-Requests": "1",
            "User-Agent": self.ua,
        }
        if referer:
            headers["Referer"] = referer

        current_url = start_url
        last_url = start_url

        for hop in range(max_hops):
            try:
                resp = self.session.get(
                    current_url,
                    headers=headers,
                    allow_redirects=False,
                    timeout=30,
                )
            except Exception as exc:
                maybe_localhost = re.search(r'(https?://localhost[^\s\'"]+)', str(exc))
                if maybe_localhost:
                    code = _extract_code_from_url(maybe_localhost.group(1))
                    if code:
                        self._log(f"follow[{hop + 1}] 命中 localhost 回调")
                        return code, maybe_localhost.group(1)
                self._log(f"follow[{hop + 1}] 请求异常: {exc}")
                return None, last_url

            last_url = str(resp.url)
            code = _extract_code_from_url(last_url)
            if code:
                return code, last_url

            if resp.status_code not in (301, 302, 303, 307, 308):
                return None, last_url

            location = resp.headers.get("Location", "")
            if not location:
                return None, last_url
            if location.startswith("/"):
                location = f"{self.oauth_issuer}{location}"

            code = _extract_code_from_url(location)
            if code:
                return code, location

            current_url = location
            headers["Referer"] = last_url

        return None, last_url

    def _oauth_allow_redirect_extract_code(self, url: str, referer: Optional[str] = None) -> Optional[str]:
        headers = {
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Upgrade-Insecure-Requests": "1",
            "User-Agent": self.ua,
        }
        if referer:
            headers["Referer"] = referer

        try:
            resp = self.session.get(url, headers=headers, allow_redirects=True, timeout=30)
            code = _extract_code_from_url(str(resp.url))
            if code:
                return code

            for history_item in getattr(resp, "history", []) or []:
                code = _extract_code_from_url(history_item.headers.get("Location", ""))
                if code:
                    return code
                code = _extract_code_from_url(str(history_item.url))
                if code:
                    return code
        except Exception as exc:
            maybe_localhost = re.search(r'(https?://localhost[^\s\'"]+)', str(exc))
            if maybe_localhost:
                return _extract_code_from_url(maybe_localhost.group(1))
            self._log(f"allow_redirect 获取 code 异常: {exc}")

        return None

    def _oauth_submit_workspace_and_org(
        self,
        consent_url: str,
        target_workspace_id: Optional[str] = None,
        prefer_personal: bool = False,
        prefer_missing_workspace_token: bool = False,
    ) -> Optional[str]:
        session_data = self._decode_oauth_session_cookie()
        if not session_data:
            self._log("无法解码 oai-client-auth-session")
            return None

        workspaces = session_data.get("workspaces", [])
        if not workspaces:
            self._log("OAuth session 中没有 workspace 信息")
            return None

        selected_workspace = None
        if target_workspace_id:
            selected_workspace = self._find_workspace(workspaces, target_workspace_id)
            if not selected_workspace:
                self._log(f"OAuth session 中未找到目标 workspace: {target_workspace_id}")

        if selected_workspace is None and prefer_missing_workspace_token:
            for workspace in workspaces:
                workspace_id = (workspace or {}).get("id")
                existing_token = self._existing_workspace_token(workspace_id)
                if workspace_id and not self._can_reuse_workspace_token(existing_token, workspace):
                    selected_workspace = workspace
                    self._log(
                        f"优先选择需要刷新 token 的 workspace: "
                        f"{self._workspace_display_name(selected_workspace)} ({workspace_id})"
                    )
                    break

        if selected_workspace is None and prefer_personal:
            for workspace in workspaces:
                if (workspace or {}).get("kind") == "personal":
                    selected_workspace = workspace
                    break

        if selected_workspace is None:
            selected_workspace = workspaces[0] or {}

        workspace_id = selected_workspace.get("id")
        if not workspace_id:
            self._log("OAuth session 中 workspace_id 为空")
            return None

        self._log(f"选择 OAuth workspace: {self._workspace_display_name(selected_workspace)} ({workspace_id})")

        headers = self._oauth_json_headers(consent_url)
        resp = self.session.post(
            f"{self.oauth_issuer}/api/accounts/workspace/select",
            json={"workspace_id": workspace_id},
            headers=headers,
            allow_redirects=False,
            timeout=30,
        )

        if resp.status_code in (301, 302, 303, 307, 308):
            location = resp.headers.get("Location", "")
            if location.startswith("/"):
                location = f"{self.oauth_issuer}{location}"
            code = _extract_code_from_url(location)
            if code:
                return code
            code, _ = self._oauth_follow_for_code(location, referer=consent_url)
            return code or self._oauth_allow_redirect_extract_code(location, referer=consent_url)

        if resp.status_code != 200:
            self._log(f"workspace/select 失败: {resp.status_code}")
            return None

        try:
            workspace_data = resp.json()
        except Exception:
            self._log("workspace/select 响应不是 JSON")
            return None

        workspace_next = workspace_data.get("continue_url", "")
        orgs = workspace_data.get("data", {}).get("orgs", [])

        if orgs:
            org_id = (orgs[0] or {}).get("id")
            projects = (orgs[0] or {}).get("projects", [])
            project_id = (projects[0] or {}).get("id") if projects else None
            if org_id:
                org_body = {"org_id": org_id}
                if project_id:
                    org_body["project_id"] = project_id

                org_headers = dict(headers)
                if workspace_next:
                    org_headers["Referer"] = (
                        workspace_next
                        if workspace_next.startswith("http")
                        else f"{self.oauth_issuer}{workspace_next}"
                    )

                org_resp = self.session.post(
                    f"{self.oauth_issuer}/api/accounts/organization/select",
                    json=org_body,
                    headers=org_headers,
                    allow_redirects=False,
                    timeout=30,
                )

                if org_resp.status_code in (301, 302, 303, 307, 308):
                    location = org_resp.headers.get("Location", "")
                    if location.startswith("/"):
                        location = f"{self.oauth_issuer}{location}"
                    code = _extract_code_from_url(location)
                    if code:
                        return code
                    code, _ = self._oauth_follow_for_code(location, referer=org_headers.get("Referer"))
                    return code or self._oauth_allow_redirect_extract_code(location, referer=org_headers.get("Referer"))

                if org_resp.status_code == 200:
                    try:
                        org_data = org_resp.json()
                    except Exception:
                        self._log("organization/select 响应不是 JSON")
                        return None
                    org_next = org_data.get("continue_url", "")
                    if org_next:
                        if org_next.startswith("/"):
                            org_next = f"{self.oauth_issuer}{org_next}"
                        code, _ = self._oauth_follow_for_code(org_next, referer=org_headers.get("Referer"))
                        return code or self._oauth_allow_redirect_extract_code(org_next, referer=org_headers.get("Referer"))

        if workspace_next:
            if workspace_next.startswith("/"):
                workspace_next = f"{self.oauth_issuer}{workspace_next}"
            code, _ = self._oauth_follow_for_code(workspace_next, referer=consent_url)
            return code or self._oauth_allow_redirect_extract_code(workspace_next, referer=consent_url)

        return None

    def _resolve_authorization_code(
        self,
        continue_url: str,
        page_type: str,
        target_workspace_id: Optional[str] = None,
        prefer_personal: bool = False,
        prefer_missing_workspace_token: bool = False,
    ) -> Optional[str]:
        consent_url = continue_url
        if consent_url and consent_url.startswith("/"):
            consent_url = f"{self.oauth_issuer}{consent_url}"

        if not consent_url and "consent" in (page_type or ""):
            consent_url = f"{self.oauth_issuer}/sign-in-with-chatgpt/codex/consent"

        if target_workspace_id or prefer_personal or prefer_missing_workspace_token:
            code = self._oauth_submit_workspace_and_org(
                consent_url or f"{self.oauth_issuer}/sign-in-with-chatgpt/codex/consent",
                target_workspace_id=target_workspace_id,
                prefer_personal=prefer_personal,
                prefer_missing_workspace_token=prefer_missing_workspace_token,
            )
            if code:
                return code

        if consent_url:
            code = _extract_code_from_url(consent_url)
            if code:
                return code

            code, _ = self._oauth_follow_for_code(
                consent_url,
                referer=f"{self.oauth_issuer}/log-in/password",
            )
            if code:
                return code

        consent_hint = (
            "consent" in (consent_url or "")
            or "sign-in-with-chatgpt" in (consent_url or "")
            or "workspace" in (consent_url or "")
            or "organization" in (consent_url or "")
            or "consent" in (page_type or "")
            or "organization" in (page_type or "")
        )

        if consent_hint:
            code = self._oauth_submit_workspace_and_org(
                consent_url or f"{self.oauth_issuer}/sign-in-with-chatgpt/codex/consent",
                target_workspace_id=target_workspace_id,
                prefer_personal=prefer_personal,
                prefer_missing_workspace_token=prefer_missing_workspace_token,
            )
            if code:
                return code

        fallback_consent = f"{self.oauth_issuer}/sign-in-with-chatgpt/codex/consent"
        code = self._oauth_submit_workspace_and_org(
            fallback_consent,
            target_workspace_id=target_workspace_id,
            prefer_personal=prefer_personal,
            prefer_missing_workspace_token=prefer_missing_workspace_token,
        )
        if code:
            return code

        code, _ = self._oauth_follow_for_code(
            fallback_consent,
            referer=f"{self.oauth_issuer}/log-in/password",
        )
        return code

    def _fetch_all_workspaces(self, token_data: Dict[str, Any]) -> List[Dict[str, Any]]:
        """获取所有 workspace 的 token 信息"""
        workspaces = []
        access_token = token_data.get("access_token", "")
        refresh_token = token_data.get("refresh_token", "")

        try:
            # 获取工作空间列表（使用 ChatGPT backend API）
            self._log("获取工作空间列表")

            resp = self.session.get(
                "https://chatgpt.com/backend-api/accounts/check/v4-2023-04-27",
                headers={
                    "User-Agent": self.ua,
                    "Accept": "application/json",
                    "Authorization": f"Bearer {access_token}",
                },
                timeout=30,
                verify=False,
            )

            self._log(f"工作空间 API 响应状态: {resp.status_code}")

            if resp.status_code != 200:
                self._log(f"获取工作空间失败: {resp.text[:200]}")
                return []

            data = resp.json()
            accounts = data.get("accounts", {})

            self._log(f"找到 {len(accounts)} 个工作空间")

            # OAuth 返回的是全局 Codex token，可以访问所有工作空间
            # 为每个工作空间保存相同的全局 token
            for account_id, account_info in accounts.items():
                workspace_name = account_info.get("account", {}).get("name", "")
                plan_type = account_info.get("account", {}).get("plan_type", "unknown")

                self._log(f"  - {workspace_name or account_id} ({plan_type})")

                # 计算过期时间（30天）
                expires_in = 30 * 24 * 3600  # 30 天（秒）
                expires_at = int(time.time() * 1000) + expires_in * 1000  # 毫秒

                workspaces.append({
                    "workspace_id": account_id,
                    "workspace_name": workspace_name,
                    "plan_type": plan_type,
                    "access_token": access_token,
                    "refresh_token": refresh_token,
                    "expires_at": expires_at,
                    "expires_in": expires_in,
                })

            if not workspaces:
                self._log("未找到任何工作空间")

            self._log("提示：同一个 OAuth token 会按 workspace 生成 sub2api 账号")

        except Exception as e:
            self._log(f"获取 workspaces 失败: {e}")
            import traceback
            traceback.print_exc()
            return []

        return workspaces
