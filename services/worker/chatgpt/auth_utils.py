"""Pure helpers for ChatGPT OAuth/token handling."""

from __future__ import annotations

import base64
import hashlib
import json
import random
import re
import secrets
import uuid
from typing import Any, Dict, List, Optional, Tuple
import time
from urllib.parse import parse_qs, unquote, urlparse
from datetime import datetime, timezone, timedelta


def generate_pkce() -> Tuple[str, str]:
    code_verifier = base64.urlsafe_b64encode(secrets.token_bytes(64)).rstrip(b"=").decode("ascii")
    digest = hashlib.sha256(code_verifier.encode("ascii")).digest()
    code_challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    return code_verifier, code_challenge


def extract_code_from_url(url: str) -> Optional[str]:
    if not url:
        return None
    parsed = urlparse(url)
    params = parse_qs(parsed.query)
    code = params.get("code", [None])[0]
    return code if code else None


def make_trace_headers() -> Dict[str, str]:
    trace_id = random.randint(10**17, 10**18 - 1)
    parent_id = random.randint(10**17, 10**18 - 1)
    traceparent = f"00-{uuid.uuid4().hex}-{format(parent_id, '016x')}-01"
    return {
        "traceparent": traceparent,
        "tracestate": "dd=s:1;o:rum",
        "x-datadog-origin": "rum",
        "x-datadog-sampling-priority": "1",
        "x-datadog-trace-id": str(trace_id),
        "x-datadog-parent-id": str(parent_id),
    }


def decode_jwt_payload(token: str) -> Dict[str, Any]:
    if not token or "." not in token:
        return {}
    try:
        payload = token.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        decoded = base64.urlsafe_b64decode(payload)
        data = json.loads(decoded.decode("utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def decode_oauth_session_cookie_value(raw_value: str) -> Optional[Dict[str, Any]]:
    if not raw_value:
        return None

    candidates = [raw_value.strip()]
    decoded_value = unquote(candidates[0])
    if decoded_value != candidates[0]:
        candidates.append(decoded_value)

    for value in candidates:
        try:
            if (value.startswith('"') and value.endswith('"')) or (value.startswith("'") and value.endswith("'")):
                value = value[1:-1]
            part = value.split(".")[0] if "." in value else value
            padding = 4 - len(part) % 4
            if padding != 4:
                part += "=" * padding
            raw = base64.urlsafe_b64decode(part)
            data = json.loads(raw.decode("utf-8"))
            if isinstance(data, dict):
                return data
        except Exception:
            continue
    return None


def workspace_display_name(workspace: Dict[str, Any]) -> str:
    return (
        (workspace or {}).get("name")
        or (workspace or {}).get("profile_picture_alt_text")
        or (workspace or {}).get("id")
        or "未命名"
    )


def find_workspace(workspaces: List[Dict[str, Any]], workspace_id: Optional[str]) -> Optional[Dict[str, Any]]:
    if not workspace_id:
        return None
    for workspace in workspaces:
        if (workspace or {}).get("id") == workspace_id:
            return workspace
    return None


def build_workspace_token_result(
    token_data: Dict[str, Any],
    known_workspaces: List[Dict[str, Any]],
    expected_workspace_id: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    access_token = token_data.get("access_token", "")
    refresh_token = token_data.get("refresh_token", "")
    if not access_token:
        return None

    payload = decode_jwt_payload(access_token)
    auth_payload = payload.get("https://api.openai.com/auth", {}) if isinstance(payload, dict) else {}
    token_workspace_id = auth_payload.get("chatgpt_account_id") or expected_workspace_id
    token_user_id = auth_payload.get("chatgpt_user_id")
    plan_type = auth_payload.get("chatgpt_plan_type")
    jti = payload.get("jti") if isinstance(payload, dict) else None

    workspace = find_workspace(known_workspaces, token_workspace_id) or {}
    workspace_name = workspace_display_name(workspace) if workspace else token_workspace_id
    workspace_kind = workspace.get("kind") if workspace else None

    id_token = token_data.get("id_token", "")
    expires_in = token_data.get("expires_in") or 30 * 24 * 3600
    expires_at = token_data.get("expires_at")
    if expires_at is None:
        expires_at = int(time.time() * 1000) + int(expires_in) * 1000

    shanghai_tz = timezone(timedelta(hours=8))
    expired = ""
    exp_timestamp = payload.get("exp") if isinstance(payload, dict) else None
    if isinstance(exp_timestamp, int) and exp_timestamp > 0:
        expired = datetime.fromtimestamp(exp_timestamp, tz=shanghai_tz).strftime("%Y-%m-%dT%H:%M:%S+08:00")

    matched = token_workspace_id == expected_workspace_id if expected_workspace_id else True
    return {
        "type": "codex",
        "email": token_data.get("email", ""),
        "expired": expired,
        "id_token": id_token,
        "account_id": token_workspace_id,
        "last_refresh": datetime.now(tz=shanghai_tz).strftime("%Y-%m-%dT%H:%M:%S+08:00"),
        "workspace_id": token_workspace_id,
        "workspace_name": workspace_name,
        "kind": workspace_kind,
        "plan_type": plan_type or "unknown",
        "access_token": access_token,
        "refresh_token": refresh_token or "",
        "expires_at": expires_at,
        "expires_in": expires_in,
        "user_id": token_user_id,
        "jti": jti,
        "matched": matched,
    }


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
        matches = re.findall(pattern, content, re.IGNORECASE)
        for code in matches:
            if code == "177010":
                continue
            return code
    return None
