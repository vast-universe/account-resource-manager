"""Workflow for exporting ChatGPT workspace tokens to sub2api format."""

from __future__ import annotations

import json
import logging
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from zoneinfo import ZoneInfo

import psycopg2
from psycopg2.extras import RealDictCursor

logger = logging.getLogger(__name__)
SHANGHAI_TZ = ZoneInfo("Asia/Shanghai")


class ChatGPTSub2ApiExportError(Exception):
    def __init__(self, message: str, status_code: int = 500):
        super().__init__(message)
        self.status_code = status_code


def _connect(database_url: str):
    return psycopg2.connect(database_url)


def _load_workspace_tokens(raw_tokens: Any) -> List[Dict[str, Any]]:
    if not raw_tokens:
        return []
    if isinstance(raw_tokens, str):
        try:
            raw_tokens = json.loads(raw_tokens)
        except Exception:
            return []
    return raw_tokens if isinstance(raw_tokens, list) else []


def _format_batch_date(reference: datetime | None = None) -> str:
    current = (reference or datetime.now(timezone.utc)).astimezone(SHANGHAI_TZ)
    return f"{current.month}-{current.day}"


def _normalize_card_type(card_type: Any) -> str:
    return "长效" if card_type == "长效" else "短效"


def _ensure_card_type_column(cursor) -> None:
    cursor.execute(
        "ALTER TABLE chatgpt_accounts ADD COLUMN IF NOT EXISTS card_type TEXT NOT NULL DEFAULT '短效'"
    )
    cursor.execute(
        "UPDATE chatgpt_accounts SET card_type = '短效' WHERE card_type IS NULL OR card_type NOT IN ('短效', '长效')"
    )


def _build_sub2api_account(
    email: str,
    workspace: Dict[str, Any],
    sequence: int,
    batch_date: str,
    card_type: str = "短效",
) -> Dict[str, Any]:
    normalized_card_type = _normalize_card_type(card_type)
    workspace_id = workspace.get("workspace_id", "")
    access_token = workspace.get("access_token", "")
    refresh_token = workspace.get("refresh_token", "")
    expires_at = workspace.get("expires_at", 0)
    expires_in = workspace.get("expires_in", 0)

    credentials = {
        "refresh_token": refresh_token,
        "chatgpt_account_id": workspace_id,
    }

    if access_token:
        credentials["access_token"] = access_token
        credentials["_token_version"] = int(time.time() * 1000)
        if expires_at:
            credentials["expires_at"] = expires_at
        if expires_in:
            credentials["expires_in"] = expires_in
        credentials["email"] = email
        credentials["chatgpt_user_id"] = ""

    return {
        "name": f"{batch_date}-{normalized_card_type} #{sequence}",
        "platform": "openai",
        "type": "oauth",
        "credentials": credentials,
        "extra": {
            "email": email,
            "plan_type": workspace.get("plan_type", "unknown"),
            "card_type": normalized_card_type,
        },
        "concurrency": 10,
        "priority": 1,
        "rate_multiplier": 1,
        "auto_pause_on_expired": True,
        "proxy_id": None,
    }


def export_sub2api(database_url: str, account_ids: Optional[List[int]] = None) -> Dict[str, Any]:
    selected_ids = [int(account_id) for account_id in (account_ids or []) if account_id]
    selected_filter = ""
    params: List[Any] = []
    if selected_ids:
        selected_filter = "AND id = ANY(%s)"
        params.append(selected_ids)

    conn = _connect(database_url)
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    try:
        _ensure_card_type_column(cursor)
        conn.commit()
        cursor.execute(
            f"""
            SELECT id, email, workspace_tokens, card_type
            FROM chatgpt_accounts
            WHERE workspace_tokens IS NOT NULL
              AND workspace_tokens != '[]'::jsonb
              AND deleted_at IS NULL
              {selected_filter}
            ORDER BY created_at DESC
            """,
            params,
        )
        accounts = cursor.fetchall()
    finally:
        cursor.close()
        conn.close()

    if not accounts:
        raise ChatGPTSub2ApiExportError("没有可导出的 workspace tokens", 404)

    sub2api_accounts: List[Dict[str, Any]] = []
    batch_date = _format_batch_date()
    sequence = 1
    for account in accounts:
        email = account.get("email", "")
        card_type = _normalize_card_type(account.get("card_type"))
        workspace_tokens = [
            workspace
            for workspace in _load_workspace_tokens(account.get("workspace_tokens"))
            if workspace.get("workspace_id") not in ("default", "global")
        ]
        for workspace in workspace_tokens:
            sub2api_accounts.append(
                _build_sub2api_account(email, workspace, sequence, batch_date, card_type)
            )
            sequence += 1

    if not sub2api_accounts:
        raise ChatGPTSub2ApiExportError("没有可导出的有效 workspace tokens", 404)

    batch_import = {
        "exported_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "proxies": [],
        "accounts": sub2api_accounts,
    }
    content = json.dumps(batch_import, indent=2, ensure_ascii=False)
    logger.info("导出 sub2api 配置: %s 个 workspace", len(sub2api_accounts))

    return {
        "success": True,
        "count": len(sub2api_accounts),
        "account_count": len(accounts),
        "data": batch_import,
        "content": content,
        "filename": "sub2api_batch_import.json",
    }
