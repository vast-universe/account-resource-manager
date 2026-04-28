"""MoeMail API client for worker workflows."""

from __future__ import annotations

import html
import logging
import re
import time
from typing import Any, Dict, List, Optional

import requests
from integrations.moemail_webhook_cache import pop_invite_url

logger = logging.getLogger(__name__)


def _message_time_ms(message: Dict[str, Any]) -> int:
    for field in (
        "timestamp",
        "receivedAt",
        "received_at",
        "receivedTime",
        "received_time",
        "createdAt",
        "created_at",
        "updatedAt",
        "updated_at",
        "date",
    ):
        value = message.get(field)
        if not value:
            continue
        try:
            numeric = float(value)
            if numeric > 0:
                return int(numeric if numeric > 10_000_000_000 else numeric * 1000)
        except Exception:
            pass
        if isinstance(value, str):
            try:
                from email.utils import parsedate_to_datetime

                return int(parsedate_to_datetime(value).timestamp() * 1000)
            except Exception:
                try:
                    from datetime import datetime

                    return int(datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp() * 1000)
                except Exception:
                    pass
    return 0


def _message_content(message: Dict[str, Any]) -> str:
    return "\n".join(
        str(value)
        for value in [
            message.get("subject"),
            message.get("content"),
            message.get("text"),
            message.get("body"),
            message.get("bodyText"),
            message.get("bodyHtml"),
            message.get("html"),
            message.get("snippet"),
            message.get("preview"),
            message.get("raw"),
            message.get("data"),
        ]
        if value
    )


def _message_id(message: Dict[str, Any]) -> str:
    for field in ("id", "messageId", "message_id", "_id"):
        value = message.get(field)
        if value:
            return str(value)
    return ""


def extract_invite_url(content: str) -> str:
    urls = []
    for match in re.finditer(r"href=[\"']([^\"']+)[\"']", content, re.IGNORECASE):
        urls.append(html.unescape(match.group(1)))
    for match in re.finditer(r"https?://[^\s\"'<>]+", content, re.IGNORECASE):
        urls.append(html.unescape(match.group(0)))

    def clean_url(value: str) -> str:
        return html.unescape(str(value or "")).strip().rstrip(").,;")

    cleaned_urls = []
    seen = set()
    for url in urls:
        cleaned = clean_url(url)
        if cleaned and cleaned not in seen:
            seen.add(cleaned)
            cleaned_urls.append(cleaned)

    for url in cleaned_urls:
        lower = url.lower()
        if "chatgpt.com/auth/login" in lower and "accept_wid=" in lower:
            return url

    for url in cleaned_urls:
        lower = url.lower()
        if "chatgpt.com" in lower and "accept_wid=" in lower:
            return url

    for url in cleaned_urls:
        lower = url.lower()
        if "help.openai.com" in lower:
            continue
        if "chatgpt.com" in lower and ("invite" in lower or "invitation" in lower):
            return url
    return ""


class MoeMailClient:
    def __init__(self, api_url: str, api_key: str):
        self.api_url = api_url.rstrip("/")
        self.api_key = api_key
        self.session = requests.Session()

    def _headers(self) -> Dict[str, str]:
        return {
            "X-API-Key": self.api_key,
            "Content-Type": "application/json",
            "Cache-Control": "no-cache",
            "Pragma": "no-cache",
        }

    def list_messages(self, email_id: str, cursor: Optional[str] = None) -> Dict[str, Any]:
        url = f"{self.api_url}/api/emails/{email_id}"
        params = {"_t": int(time.time() * 1000)}
        if cursor:
            params["cursor"] = cursor
        logger.info("[MoeMailInvite] 拉取邮件列表: email_id=%s cursor=%s", email_id, cursor or "-")
        response = self.session.get(url, headers=self._headers(), params=params, timeout=15)
        logger.info("[MoeMailInvite] 邮件列表响应: email_id=%s status=%s", email_id, response.status_code)
        response.raise_for_status()
        return response.json()

    def get_message_detail(self, email_id: str, message_id: str) -> Dict[str, Any]:
        logger.info("[MoeMailInvite] 拉取邮件详情: email_id=%s message_id=%s", email_id, message_id)
        response = self.session.get(
            f"{self.api_url}/api/emails/{email_id}/{message_id}",
            headers=self._headers(),
            timeout=15,
        )
        logger.info(
            "[MoeMailInvite] 邮件详情响应: email_id=%s message_id=%s status=%s",
            email_id,
            message_id,
            response.status_code,
        )
        response.raise_for_status()
        return response.json()

    def get_all_messages(self, email_id: str, max_pages: int = 3) -> List[Dict[str, Any]]:
        messages: List[Dict[str, Any]] = []
        cursor = None
        for _ in range(max_pages):
            data = self.list_messages(email_id, cursor)
            page_messages = []
            if isinstance(data, dict):
                candidates = [data.get("messages"), data.get("items"), data.get("results"), data.get("data")]
                nested_data = data.get("data")
                if isinstance(nested_data, dict):
                    candidates.extend([
                        nested_data.get("messages"),
                        nested_data.get("items"),
                        nested_data.get("results"),
                    ])
                for candidate in candidates:
                    if isinstance(candidate, list):
                        page_messages = candidate
                        break
            logger.info(
                "[MoeMailInvite] 邮件页解析: email_id=%s page_messages=%s nextCursor=%s",
                email_id,
                len(page_messages) if isinstance(page_messages, list) else 0,
                (data.get("nextCursor") if isinstance(data, dict) else None) or "-",
            )
            if isinstance(page_messages, list):
                messages.extend([message for message in page_messages if isinstance(message, dict)])
            cursor = data.get("nextCursor") if isinstance(data, dict) else None
            if not cursor and isinstance(data, dict) and isinstance(data.get("data"), dict):
                cursor = data["data"].get("nextCursor")
            if not cursor or not page_messages:
                break
        messages.sort(key=_message_time_ms, reverse=True)
        return messages

    def wait_for_invite_url(
        self,
        email_id: str,
        sent_after_ms: int,
        timeout_seconds: int = 90,
        poll_seconds: int = 3,
    ) -> str:
        started_at = time.time()
        checked_message_ids = set()
        while time.time() - started_at < timeout_seconds:
            try:
                webhook_invite_url = pop_invite_url(email_id, sent_after_ms)
                if webhook_invite_url:
                    logger.info("[MoeMailInvite] Webhook 命中邀请链接: email_id=%s", email_id)
                    return webhook_invite_url

                messages = self.get_all_messages(email_id, max_pages=2)
                logger.info(
                    "[MoeMailInvite] 轮询邀请邮件: email_id=%s messages=%s checked=%s elapsed=%ss",
                    email_id,
                    len(messages),
                    len(checked_message_ids),
                    int(time.time() - started_at),
                )
                for message in messages:
                    message_id = _message_id(message)
                    if not message_id or message_id in checked_message_ids:
                        continue
                    checked_message_ids.add(message_id)

                    message_time = _message_time_ms(message)
                    if message_time > 0 and message_time < sent_after_ms - 120_000:
                        logger.info(
                            "[MoeMailInvite] 跳过旧邮件: email_id=%s message_id=%s message_time=%s sent_after=%s",
                            email_id,
                            message_id,
                            message_time,
                            sent_after_ms,
                        )
                        continue

                    content = _message_content(message)
                    logger.info(
                        "[MoeMailInvite] 检查邮件: email_id=%s message_id=%s subject=%s content_len=%s",
                        email_id,
                        message_id,
                        str(message.get("subject") or "")[:120],
                        len(content),
                    )
                    try:
                        detail = self.get_message_detail(email_id, str(message_id))
                        detail_message = detail.get("message") if isinstance(detail, dict) else None
                        if isinstance(detail_message, dict):
                            content = f"{content}\n{_message_content(detail_message)}"
                        elif isinstance(detail, dict):
                            content = f"{content}\n{_message_content(detail)}"
                    except Exception as exc:
                        logger.debug("读取 MoeMail 邮件详情失败，继续使用列表内容: %s", exc)

                    invite_url = extract_invite_url(content)
                    if invite_url:
                        logger.info(
                            "[MoeMailInvite] 提取到邀请链接: email_id=%s message_id=%s url=%s",
                            email_id,
                            message_id,
                            invite_url[:220],
                        )
                        return invite_url
                    logger.info("[MoeMailInvite] 未从邮件提取到邀请链接: email_id=%s message_id=%s", email_id, message_id)
            except Exception as exc:
                logger.warning("查询 MoeMail 邀请邮件失败: %s", exc)

            time.sleep(poll_seconds)
        return ""
