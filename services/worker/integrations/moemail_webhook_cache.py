"""In-memory MoeMail webhook cache for OTP and invite links."""

from __future__ import annotations

import html
import re
import threading
import time
from datetime import datetime
from typing import Any, Dict, List, Optional


_LOCK = threading.Lock()
_EVENTS: Dict[str, List[Dict[str, Any]]] = {}
_TTL_SECONDS = 15 * 60


def _parse_timestamp(value: Any) -> float:
    if value is None:
        return time.time()
    if isinstance(value, (int, float)):
        timestamp = float(value)
        return timestamp / 1000 if timestamp > 1_000_000_000_000 else timestamp
    text = str(value).strip()
    if not text:
        return time.time()
    if text.isdigit():
        timestamp = float(text)
        return timestamp / 1000 if timestamp > 1_000_000_000_000 else timestamp
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return time.time()


def _searchable_text(*parts: Any) -> str:
    raw = " ".join(str(part or "") for part in parts if part)
    if not raw:
        return ""
    text = html.unescape(raw)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def extract_verification_code(content: str) -> Optional[str]:
    patterns = [
        r"Verification code:?\s*(\d{6})",
        r"code is\s*(\d{6})",
        r"代码为[:：]?\s*(\d{6})",
        r"验证码[:：]?\s*(\d{6})",
        r">\s*(\d{6})\s*<",
        r"(?<![#&])\b(\d{6})\b",
    ]
    for pattern in patterns:
        for code in re.findall(pattern, content or "", re.IGNORECASE):
            if code in {"177010", "202123", "202167", "353740"}:
                continue
            return code
    return None


def extract_invite_url(content: str) -> str:
    urls = []
    for match in re.finditer(r"href=[\"']([^\"']+)[\"']", content or "", re.IGNORECASE):
        urls.append(html.unescape(match.group(1)))
    for match in re.finditer(r"https?://[^\s\"'<>]+", content or "", re.IGNORECASE):
        urls.append(html.unescape(match.group(0)))

    cleaned_urls = []
    seen = set()
    for url in urls:
        cleaned = html.unescape(str(url or "")).strip().rstrip(").,;")
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


def _cleanup_locked() -> None:
    cutoff = time.time() - _TTL_SECONDS
    empty_keys = []
    for email_id, events in _EVENTS.items():
        _EVENTS[email_id] = [event for event in events if event.get("created_at", 0) >= cutoff]
        if not _EVENTS[email_id]:
            empty_keys.append(email_id)
    for email_id in empty_keys:
        _EVENTS.pop(email_id, None)


def store_webhook_event(payload: Dict[str, Any]) -> Dict[str, Any]:
    email_id = str(payload.get("emailId") or payload.get("email_id") or "").strip()
    if not email_id:
        return {"stored": False, "reason": "missing_email_id"}

    message_id = str(payload.get("messageId") or payload.get("message_id") or "").strip()
    content = _searchable_text(
        payload.get("subject"),
        payload.get("content"),
        payload.get("text"),
        payload.get("body"),
        payload.get("html"),
        payload.get("raw"),
    )
    event = {
        "email_id": email_id,
        "message_id": message_id,
        "from_address": payload.get("fromAddress") or payload.get("from_address"),
        "to_address": payload.get("toAddress") or payload.get("to_address"),
        "subject": payload.get("subject"),
        "content": content,
        "verification_code": extract_verification_code(content),
        "invite_url": extract_invite_url(content),
        "received_at": _parse_timestamp(payload.get("receivedAt") or payload.get("received_at")),
        "created_at": time.time(),
        "code_consumed": False,
        "invite_consumed": False,
    }

    with _LOCK:
        _cleanup_locked()
        events = _EVENTS.setdefault(email_id, [])
        if message_id:
            events[:] = [item for item in events if item.get("message_id") != message_id]
        events.append(event)
        events.sort(key=lambda item: item.get("received_at") or item.get("created_at") or 0, reverse=True)

    return {
        "stored": True,
        "email_id": email_id,
        "message_id": message_id,
        "has_verification_code": bool(event["verification_code"]),
        "has_invite_url": bool(event["invite_url"]),
    }


def pop_verification_code(email_id: str, max_age_seconds: int = 600) -> Optional[str]:
    cutoff = time.time() - max_age_seconds
    with _LOCK:
        _cleanup_locked()
        for event in _EVENTS.get(email_id, []):
            if event.get("code_consumed"):
                continue
            if (event.get("received_at") or event.get("created_at") or 0) < cutoff:
                continue
            code = event.get("verification_code")
            if code:
                event["code_consumed"] = True
                return str(code)
    return None


def pop_invite_url(email_id: str, sent_after_ms: int = 0) -> str:
    sent_after_seconds = sent_after_ms / 1000 if sent_after_ms else 0
    with _LOCK:
        _cleanup_locked()
        for event in _EVENTS.get(email_id, []):
            if event.get("invite_consumed"):
                continue
            if sent_after_seconds and (event.get("received_at") or event.get("created_at") or 0) < sent_after_seconds - 120:
                continue
            invite_url = event.get("invite_url")
            if invite_url:
                event["invite_consumed"] = True
                return str(invite_url)
    return ""
