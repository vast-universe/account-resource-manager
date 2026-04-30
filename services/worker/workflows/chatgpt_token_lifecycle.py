"""Token lifecycle helpers for ChatGPT OAuth workspace tokens."""

from __future__ import annotations

import json
import logging
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import psycopg2
import requests
from psycopg2.extras import RealDictCursor

from chatgpt.auth_utils import build_workspace_token_result, decode_jwt_payload
from resources.chatgpt.workspaces import load_workspace_tokens
from workflows.chatgpt_extract_tokens import (
    ChatGPTTokenExtractionError,
    detect_subscription_type,
    update_chatgpt_account_refresh_status,
)

logger = logging.getLogger(__name__)

OPENAI_OAUTH_TOKEN_URL = "https://auth.openai.com/oauth/token"
OPENAI_OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
OPENAI_OAUTH_REFRESH_SCOPE = "openid profile email"
OAUTH_USER_AGENT = "codex_cli_rs/0.1.0"


def _connect(database_url: str):
    return psycopg2.connect(database_url)


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_plan_type(value: Any) -> str:
    plan_type = str(value or "").strip().lower()
    if plan_type in {"free", "plus", "team"}:
        return plan_type
    if "team" in plan_type:
        return "team"
    if "plus" in plan_type or "pro" in plan_type:
        return "plus"
    if plan_type:
        return plan_type
    return "unknown"


def _extract_plan_type_from_token_data(token_data: Dict[str, Any]) -> str:
    for token_key in ("access_token", "id_token"):
        payload = decode_jwt_payload(str(token_data.get(token_key) or ""))
        auth_payload = payload.get("https://api.openai.com/auth") if isinstance(payload, dict) else None
        if not isinstance(auth_payload, dict):
            continue
        plan_type = _normalize_plan_type(auth_payload.get("chatgpt_plan_type"))
        if plan_type != "unknown":
            return plan_type
    return "unknown"


def _workspace_as_known_workspace(workspace: Dict[str, Any]) -> Dict[str, Any]:
    workspace_id = workspace.get("workspace_id") or workspace.get("id")
    return {
        "id": workspace_id,
        "name": workspace.get("workspace_name") or workspace.get("name") or workspace_id,
        "kind": workspace.get("kind"),
    }


def _refresh_oauth_token(refresh_token: str, proxy_url: Optional[str] = None) -> Dict[str, Any]:
    proxies = {"http": proxy_url, "https": proxy_url} if proxy_url else None
    response = requests.post(
        OPENAI_OAUTH_TOKEN_URL,
        headers={
            "content-type": "application/x-www-form-urlencoded",
            "accept": "application/json",
            "user-agent": OAUTH_USER_AGENT,
        },
        data={
            "grant_type": "refresh_token",
            "client_id": OPENAI_OAUTH_CLIENT_ID,
            "refresh_token": refresh_token,
            "scope": OPENAI_OAUTH_REFRESH_SCOPE,
        },
        proxies=proxies,
        timeout=60,
    )
    try:
        payload = response.json() if response.content else {}
    except Exception:
        payload = {"raw": response.text[:300]}

    if not response.ok:
        error = payload.get("error_description") or payload.get("error") if isinstance(payload, dict) else None
        raise ChatGPTTokenExtractionError(
            f"OAuth refresh failed: HTTP {response.status_code} {error or response.text[:200]}",
            502,
        )
    if not isinstance(payload, dict) or not payload.get("access_token"):
        raise ChatGPTTokenExtractionError("OAuth refresh 响应缺少 access_token", 502)
    return payload


def _build_refreshed_workspace_token(
    workspace: Dict[str, Any],
    token_data: Dict[str, Any],
) -> Dict[str, Any]:
    workspace_id = workspace.get("workspace_id") or workspace.get("id")
    if not token_data.get("refresh_token"):
        token_data = {**token_data, "refresh_token": workspace.get("refresh_token") or ""}
    if not token_data.get("email") and workspace.get("email"):
        token_data = {**token_data, "email": workspace.get("email") or ""}

    result = build_workspace_token_result(
        token_data,
        [_workspace_as_known_workspace(workspace)],
        expected_workspace_id=workspace_id,
    )
    if result is None:
        result = dict(workspace)
        result["access_token"] = token_data.get("access_token") or workspace.get("access_token") or ""
        result["refresh_token"] = token_data.get("refresh_token") or workspace.get("refresh_token") or ""
        result["expires_in"] = token_data.get("expires_in") or workspace.get("expires_in") or 30 * 24 * 3600
        result["expires_at"] = token_data.get("expires_at") or int(time.time() * 1000) + int(result["expires_in"]) * 1000

    plan_type = _extract_plan_type_from_token_data(token_data)
    if plan_type != "unknown":
        result["plan_type"] = plan_type

    result["workspace_id"] = result.get("workspace_id") or workspace_id
    result["workspace_name"] = result.get("workspace_name") or workspace.get("workspace_name") or workspace_id
    result["kind"] = result.get("kind") or workspace.get("kind")
    result["id_token"] = token_data.get("id_token") or workspace.get("id_token") or ""
    result["last_refreshed_at"] = _utc_now_iso()
    result["refresh_status"] = "healthy"
    result["refresh_error"] = None
    return result


def _save_refreshed_workspace_tokens(
    database_url: str,
    account_id: int,
    workspaces: List[Dict[str, Any]],
    check_result: Optional[str] = None,
) -> Optional[str]:
    subscription_type = detect_subscription_type(workspaces)
    first_workspace = workspaces[0] if workspaces else {}
    now = datetime.now()
    conn = _connect(database_url)
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            UPDATE chatgpt_accounts
            SET
                access_token = COALESCE(NULLIF(%s, ''), access_token),
                refresh_token = COALESCE(NULLIF(%s, ''), refresh_token),
                id_token = COALESCE(NULLIF(%s, ''), id_token),
                account_id = COALESCE(NULLIF(%s, ''), account_id),
                workspace_tokens = %s,
                subscription_type = COALESCE(%s, subscription_type),
                status = 'active',
                health_status = %s,
                last_checked_at = %s,
                last_check_result = %s,
                updated_at = %s
            WHERE id = %s AND deleted_at IS NULL
            """,
            (
                first_workspace.get("access_token", ""),
                first_workspace.get("refresh_token", ""),
                first_workspace.get("id_token", ""),
                first_workspace.get("account_id") or first_workspace.get("workspace_id", ""),
                json.dumps(workspaces),
                subscription_type,
                "healthy" if check_result is None else "warning",
                now,
                check_result,
                now,
                account_id,
            ),
        )
        conn.commit()
    finally:
        cursor.close()
        conn.close()
    return subscription_type


def _load_account_workspace_tokens(database_url: str, account_id: int) -> Dict[str, Any]:
    conn = _connect(database_url)
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cursor.execute(
            """
            SELECT id, email, workspace_tokens
            FROM chatgpt_accounts
            WHERE id = %s AND deleted_at IS NULL
            """,
            (account_id,),
        )
        account = cursor.fetchone()
    finally:
        cursor.close()
        conn.close()

    if not account:
        raise ChatGPTTokenExtractionError("账号不存在", 404)
    return dict(account)


def refresh_subscription_status(
    database_url: str,
    account_id: int,
    workspace_id: Optional[str] = None,
    proxy_url: Optional[str] = None,
) -> Dict[str, Any]:
    """Refresh saved OAuth workspace tokens and update account subscription type."""

    account = _load_account_workspace_tokens(database_url, account_id)
    workspaces = load_workspace_tokens(account.get("workspace_tokens"))
    if not workspaces:
        update_chatgpt_account_refresh_status(
            database_url,
            account_id,
            "abnormal",
            "invalid",
            "账号缺少 workspace tokens，请先完整提取 tokens",
        )
        raise ChatGPTTokenExtractionError("账号缺少 workspace tokens，请先完整提取 tokens", 400)

    target_workspace_id = str(workspace_id or "").strip()
    refreshed_count = 0
    failed_count = 0
    updated_workspaces: List[Dict[str, Any]] = []
    errors: List[str] = []

    for workspace in workspaces:
        if not isinstance(workspace, dict):
            continue
        current_workspace_id = str(workspace.get("workspace_id") or "").strip()
        if target_workspace_id and current_workspace_id != target_workspace_id:
            updated_workspaces.append(workspace)
            continue

        refresh_token = str(workspace.get("refresh_token") or "").strip()
        if not refresh_token:
            failed_count += 1
            next_workspace = dict(workspace)
            next_workspace["refresh_status"] = "invalid"
            next_workspace["refresh_error"] = "missing refresh_token"
            updated_workspaces.append(next_workspace)
            errors.append(f"{current_workspace_id or 'unknown'}: missing refresh_token")
            continue

        try:
            token_data = _refresh_oauth_token(refresh_token, proxy_url=proxy_url)
            token_data["email"] = account.get("email") or workspace.get("email") or ""
            updated_workspaces.append(_build_refreshed_workspace_token(workspace, token_data))
            refreshed_count += 1
        except ChatGPTTokenExtractionError as exc:
            failed_count += 1
            next_workspace = dict(workspace)
            next_workspace["refresh_status"] = "invalid" if "invalid_grant" in str(exc) else "failed"
            next_workspace["refresh_error"] = str(exc)
            next_workspace["last_refreshed_at"] = _utc_now_iso()
            updated_workspaces.append(next_workspace)
            errors.append(f"{current_workspace_id or 'unknown'}: {exc}")

    if target_workspace_id and refreshed_count == 0 and failed_count == 0:
        raise ChatGPTTokenExtractionError("指定 workspace 不存在", 404)

    check_result = "; ".join(errors[:3]) if errors else None
    subscription_type = _save_refreshed_workspace_tokens(
        database_url,
        account_id,
        updated_workspaces,
        check_result=check_result,
    )

    if refreshed_count == 0:
        update_chatgpt_account_refresh_status(
            database_url,
            account_id,
            "abnormal",
            "invalid",
            check_result or "没有可刷新的 workspace token",
        )
        raise ChatGPTTokenExtractionError(check_result or "没有可刷新的 workspace token", 502)

    logger.info(
        "已刷新 ChatGPT token: account_id=%s refreshed=%s failed=%s subscription=%s",
        account_id,
        refreshed_count,
        failed_count,
        subscription_type,
    )
    return {
        "success": True,
        "message": f"成功刷新 {refreshed_count} 个 workspace token",
        "subscription_type": subscription_type,
        "refreshed_count": refreshed_count,
        "failed_count": failed_count,
        "workspaces": updated_workspaces,
        "errors": errors,
    }
