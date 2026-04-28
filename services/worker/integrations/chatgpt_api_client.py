"""HTTP client for ChatGPT backend-api calls used by worker services."""

from __future__ import annotations

import logging
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError
from dataclasses import dataclass
from typing import Any, Dict, List

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from curl_cffi import requests as curl_requests

logger = logging.getLogger(__name__)

CHATGPT_BASE = "https://chatgpt.com"
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/145.0.0.0 Safari/537.36"
)

SUCCESS_MARKERS = (
    "你已被添加至",
    "已被添加至",
    "you have been added",
    "you've been added",
    "added to",
    "加入该工作空间",
)


@dataclass
class ChatGPTApiResult:
    ok: bool
    status_code: int
    payload: Any = None
    error: str = ""


def create_session(proxy: str = "") -> requests.Session:
    session = requests.Session()
    retry = Retry(total=3, backoff_factor=1, status_forcelist=[429, 500, 502, 503, 504])
    adapter = HTTPAdapter(max_retries=retry)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    if proxy:
        session.proxies = {"http": proxy, "https": proxy}
    return session


def looks_like_cloudflare(status_code: int, text: str) -> bool:
    lower_text = (text or "").lower()
    return status_code in (403, 429) or any(
        marker in lower_text
        for marker in ("cf-challenge", "cf_clearance", "just a moment", "cloudflare", "attention required")
    )


def looks_like_invite_success(text: str) -> bool:
    lower_text = (text or "").lower()
    return any(marker in lower_text for marker in SUCCESS_MARKERS)


class ChatGPTApiClient:
    """Thin wrapper around ChatGPT backend-api endpoints."""

    def __init__(self, proxy: str = ""):
        self.proxy = proxy
        self.session = create_session(proxy)

    def _create_browser_session(self):
        session = curl_requests.Session(impersonate="chrome136")
        if self.proxy:
            session.proxies = {"http": self.proxy, "https": self.proxy}
        device_id = str(uuid.uuid4())
        session.cookies.set("oai-did", device_id, domain=".chatgpt.com")
        session.cookies.set("oai-did", device_id, domain="chatgpt.com")
        session.headers.update({
            "user-agent": USER_AGENT,
            "sec-ch-ua": '"Google Chrome";v="145", "Not?A_Brand";v="8", "Chromium";v="145"',
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"Windows"',
            "accept-language": "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7",
        })
        return session

    def send_team_invitation(
        self,
        mother_email: str,
        access_token: str,
        account_id: str,
        invited_email: str,
    ) -> ChatGPTApiResult:
        invite_url = f"{CHATGPT_BASE}/backend-api/accounts/{account_id}/invites"
        headers = {
            "accept": "*/*",
            "accept-language": "en-US,en;q=0.9",
            "authorization": f"Bearer {access_token}",
            "chatgpt-account-id": account_id,
            "content-type": "application/json",
            "origin": CHATGPT_BASE,
            "referer": f"{CHATGPT_BASE}/",
            "user-agent": USER_AGENT,
        }
        payload = {
            "email_addresses": [invited_email],
            "role": "standard-user",
            "resend_emails": True,
        }

        last_result = ChatGPTApiResult(False, 0, None, "邀请失败")
        max_attempts = 3
        for attempt in range(1, max_attempts + 1):
            logger.info(
                "[TeamInvite] 发送邀请: mother=%s account_id=%s invited=%s attempt=%s/%s",
                mother_email,
                account_id,
                invited_email,
                attempt,
                max_attempts,
            )
            try:
                response = self.session.post(
                    invite_url,
                    headers=headers,
                    json=payload,
                    timeout=30,
                    verify=False,
                )
                response_payload = response.json() if response.content else None
                logger.info(
                    "[TeamInvite] 邀请响应: invited=%s status=%s payload_keys=%s attempt=%s/%s",
                    invited_email,
                    response.status_code,
                    list(response_payload.keys()) if isinstance(response_payload, dict) else type(response_payload).__name__,
                    attempt,
                    max_attempts,
                )
                if response.status_code != 200:
                    last_result = ChatGPTApiResult(
                        ok=False,
                        status_code=response.status_code,
                        payload=response_payload,
                        error=response.text[:300],
                    )
                elif isinstance(response_payload, dict) and response_payload.get("account_invites"):
                    logger.info("✅ 邀请成功: %s → %s", invited_email, mother_email)
                    return ChatGPTApiResult(ok=True, status_code=response.status_code, payload=response_payload)
                else:
                    error = ""
                    if isinstance(response_payload, dict) and response_payload.get("errored_emails"):
                        error = str(response_payload.get("errored_emails"))
                    else:
                        error = f"邀请响应异常: {response_payload}"
                    last_result = ChatGPTApiResult(False, response.status_code, response_payload, error)
            except Exception as exc:
                last_result = ChatGPTApiResult(False, 0, None, str(exc))

            if attempt < max_attempts:
                sleep_seconds = 2 * attempt
                logger.info(
                    "[TeamInvite] 邀请失败，%s 秒后重试: invited=%s error=%s",
                    sleep_seconds,
                    invited_email,
                    last_result.error,
                )
                time.sleep(sleep_seconds)

        return last_result

    def list_team_members(
        self,
        account_id: str,
        access_token: str,
        offset: int = 0,
        limit: int = 25,
        query: str = "",
    ) -> ChatGPTApiResult:
        url = f"{CHATGPT_BASE}/backend-api/accounts/{account_id}/users"
        headers = {
            "accept": "*/*",
            "accept-language": "zh-CN,zh;q=0.9",
            "authorization": f"Bearer {access_token}",
            "cache-control": "no-cache",
            "chatgpt-account-id": account_id,
            "content-type": "application/json",
            "oai-language": "zh-CN",
            "referer": f"{CHATGPT_BASE}/admin/members",
            "user-agent": USER_AGENT,
            "x-openai-target-path": f"/backend-api/accounts/{account_id}/users",
            "x-openai-target-route": "/backend-api/accounts/{account_id}/users",
        }
        try:
            response = self.session.get(
                url,
                headers=headers,
                params={"offset": offset, "limit": limit, "query": query},
                timeout=30,
                verify=False,
            )
            payload = response.json() if response.content else None
            return ChatGPTApiResult(response.ok, response.status_code, payload, "" if response.ok else response.text[:300])
        except Exception as exc:
            return ChatGPTApiResult(False, 0, None, str(exc))

    def _visit_invite_url_with_playwright(self, invite_url: str) -> ChatGPTApiResult:
        def run_in_thread() -> ChatGPTApiResult:
            return self._visit_invite_url_with_playwright_sync(invite_url)

        with ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(run_in_thread)
            try:
                return future.result(timeout=110)
            except FutureTimeoutError:
                return ChatGPTApiResult(False, 0, None, "Playwright 访问邀请链接超时")

    def _visit_invite_url_with_playwright_sync(self, invite_url: str) -> ChatGPTApiResult:
        try:
            from playwright.sync_api import sync_playwright
        except Exception as exc:
            return ChatGPTApiResult(False, 0, None, f"Playwright 不可用: {exc}")

        browser = None
        try:
            launch_options: Dict[str, Any] = {
                "headless": True,
                "args": [
                    "--disable-blink-features=AutomationControlled",
                    "--disable-dev-shm-usage",
                    "--no-sandbox",
                ],
            }
            if self.proxy:
                launch_options["proxy"] = {"server": self.proxy}

            logger.info("[TeamInvite] 使用 Playwright 访问邀请链接")
            with sync_playwright() as p:
                browser = p.chromium.launch(**launch_options)
                context = browser.new_context(
                    user_agent=USER_AGENT,
                    locale="zh-CN",
                    timezone_id="Asia/Shanghai",
                    viewport={"width": 1365, "height": 768},
                    extra_http_headers={
                        "accept-language": "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7",
                    },
                )
                context.add_init_script(
                    "Object.defineProperty(navigator, 'webdriver', {get: () => undefined});"
                )
                page = context.new_page()

                warmup_resp = page.goto(CHATGPT_BASE, wait_until="domcontentloaded", timeout=45_000)
                logger.info(
                    "[TeamInvite] Playwright 预热 ChatGPT 首页: status=%s final_url=%s",
                    warmup_resp.status if warmup_resp else 0,
                    page.url[:160],
                )

                response = page.goto(invite_url, wait_until="domcontentloaded", timeout=60_000)
                final_url = page.url
                status_code = response.status if response else 0
                logger.info(
                    "[TeamInvite] Playwright 访问邀请链接: status=%s final_url=%s",
                    status_code,
                    final_url[:220],
                )

                content = ""
                for attempt in range(1, 13):
                    page.wait_for_timeout(5000)
                    final_url = page.url
                    content = page.content()
                    logger.info(
                        "[TeamInvite] Playwright 等待邀请页面: attempt=%s/12 final_url=%s",
                        attempt,
                        final_url[:220],
                    )
                    if looks_like_invite_success(content):
                        break
                    if attempt in (3, 6, 9):
                        try:
                            page.reload(wait_until="domcontentloaded", timeout=45_000)
                        except Exception as reload_exc:
                            logger.info("[TeamInvite] Playwright 刷新邀请页面失败，继续等待: %s", reload_exc)

                if looks_like_invite_success(content):
                    logger.info(
                        "[TeamInvite] Playwright 邀请链接页面显示已加入: body_snippet=%s",
                        content[:240].replace("\n", " "),
                    )
                    return ChatGPTApiResult(
                        ok=True,
                        status_code=status_code,
                        payload={"final_url": final_url, "accepted_without_login": True, "browser": "playwright"},
                    )

                if looks_like_cloudflare(status_code, content):
                    logger.warning(
                        "[TeamInvite] Playwright 邀请链接仍触发 Cloudflare: status=%s body_snippet=%s",
                        status_code,
                        content[:240].replace("\n", " "),
                    )
                    return ChatGPTApiResult(
                        ok=False,
                        status_code=status_code,
                        payload={"final_url": final_url, "cloudflare_challenge": True, "browser": "playwright"},
                        error="Playwright 访问邀请链接仍触发 Cloudflare/指纹校验",
                    )

                return ChatGPTApiResult(
                    ok=False,
                    status_code=status_code,
                    payload={"final_url": final_url, "browser": "playwright"},
                    error="Playwright 邀请链接页面未出现已加入提示",
                )
        except Exception as exc:
            return ChatGPTApiResult(False, 0, None, f"Playwright 访问邀请链接失败: {exc}")
        finally:
            try:
                if browser:
                    browser.close()
            except Exception:
                pass

    def visit_invite_url(self, invite_url: str) -> ChatGPTApiResult:
        if "help.openai.com" in (invite_url or "").lower():
            return ChatGPTApiResult(
                ok=False,
                status_code=0,
                payload={"final_url": invite_url},
                error="提取到的是帮助文档链接，不是邀请接受链接",
            )

        try:
            browser_session = self._create_browser_session()
            try:
                warmup_resp = browser_session.get(
                    CHATGPT_BASE,
                    headers={
                        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                        "accept-language": "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7",
                        "cache-control": "no-cache",
                        "pragma": "no-cache",
                        "sec-fetch-dest": "document",
                        "sec-fetch-mode": "navigate",
                        "sec-fetch-site": "none",
                        "sec-fetch-user": "?1",
                        "upgrade-insecure-requests": "1",
                        "user-agent": USER_AGENT,
                    },
                    allow_redirects=True,
                    timeout=30,
                    verify=False,
                )
                logger.info(
                    "[TeamInvite] 预热 ChatGPT 首页: status=%s final_url=%s",
                    warmup_resp.status_code,
                    str(warmup_resp.url or "")[:160],
                )
            except Exception as warmup_exc:
                logger.info("[TeamInvite] 预热 ChatGPT 首页失败，继续访问邀请链接: %s", warmup_exc)

            response = browser_session.get(
                invite_url,
                headers={
                    "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "accept-language": "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7",
                    "cache-control": "no-cache",
                    "pragma": "no-cache",
                    "referer": CHATGPT_BASE,
                    "sec-fetch-dest": "document",
                    "sec-fetch-mode": "navigate",
                    "sec-fetch-site": "same-origin",
                    "sec-fetch-user": "?1",
                    "upgrade-insecure-requests": "1",
                    "user-agent": USER_AGENT,
                },
                allow_redirects=True,
                timeout=30,
                verify=False,
            )
            final_url = str(response.url or "")
            logger.info(
                "[TeamInvite] 访问邀请链接: status=%s final_url=%s",
                response.status_code,
                final_url[:220],
            )
            response_text = response.text or ""
            if looks_like_cloudflare(response.status_code, response_text):
                logger.warning(
                    "[TeamInvite] 邀请链接疑似触发 Cloudflare: status=%s final_url=%s body_snippet=%s",
                    response.status_code,
                    final_url[:220],
                    response_text[:240].replace("\n", " "),
                )
                playwright_result = self._visit_invite_url_with_playwright(invite_url)
                if playwright_result.ok:
                    return playwright_result
                return ChatGPTApiResult(
                    ok=False,
                    status_code=playwright_result.status_code or response.status_code,
                    payload=playwright_result.payload or {"final_url": final_url, "cloudflare_challenge": True},
                    error=playwright_result.error or "邀请链接访问触发 Cloudflare/指纹校验",
                )

            invite_accepted = response.ok and looks_like_invite_success(response_text)
            if invite_accepted:
                logger.info(
                    "[TeamInvite] 邀请链接页面显示已加入: final_url=%s body_snippet=%s",
                    final_url[:220],
                    response_text[:240].replace("\n", " "),
                )
                return ChatGPTApiResult(
                    ok=True,
                    status_code=response.status_code,
                    payload={"final_url": final_url, "accepted_without_login": True},
                )

            lower_final_url = final_url.lower()
            if any(marker in lower_final_url for marker in ("/auth/login", "/log-in", "auth.openai.com")):
                logger.info(
                    "[TeamInvite] 邀请链接停留在登录入口且未出现成功提示，切到 Playwright 等待: status=%s body_snippet=%s",
                    response.status_code,
                    response_text[:240].replace("\n", " "),
                )
                playwright_result = self._visit_invite_url_with_playwright(invite_url)
                if playwright_result.ok:
                    return playwright_result
                return ChatGPTApiResult(
                    ok=False,
                    status_code=playwright_result.status_code or response.status_code,
                    payload=playwright_result.payload or {"final_url": final_url},
                    error=playwright_result.error or "邀请链接需要等待浏览器检测后接受",
                )
            if "help.openai.com" in lower_final_url:
                return ChatGPTApiResult(
                    ok=False,
                    status_code=response.status_code,
                    payload={"final_url": final_url},
                    error="访问到了帮助文档链接，不是邀请接受链接",
                )
            return ChatGPTApiResult(
                ok=False,
                status_code=response.status_code,
                payload={"final_url": final_url},
                error="邀请链接页面未出现已加入提示",
            )
        except Exception as exc:
            return ChatGPTApiResult(False, 0, None, str(exc))
