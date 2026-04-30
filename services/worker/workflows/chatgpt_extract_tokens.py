"""Workflow for refreshing ChatGPT workspace tokens."""

from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

import psycopg2
from psycopg2.extras import RealDictCursor

from chatgpt.token_extractor import TokenExtractor
from repositories.email_providers import EmailProviderRepository

logger = logging.getLogger(__name__)


class ChatGPTTokenExtractionError(Exception):
    def __init__(self, message: str, status_code: int = 500):
        super().__init__(message)
        self.status_code = status_code


def _connect(database_url: str):
    return psycopg2.connect(database_url)


def _get_moemail_provider(database_url: str) -> Dict[str, Any]:
    provider = EmailProviderRepository(database_url).get_default_provider("moemail")
    if not provider or not provider.get("api_url") or not provider.get("api_key"):
        raise ChatGPTTokenExtractionError("未配置可用 MoeMail provider", 400)
    return provider


def update_chatgpt_account_refresh_status(
    database_url: str,
    account_id: int,
    status: str,
    health_status: str,
    check_result: str,
) -> None:
    try:
        conn = _connect(database_url)
        cursor = conn.cursor()
        now = datetime.now()
        cursor.execute(
            """
            UPDATE chatgpt_accounts
            SET
                status = %s,
                health_status = %s,
                last_checked_at = %s,
                last_check_result = %s,
                updated_at = %s
            WHERE id = %s AND deleted_at IS NULL
            """,
            (status, health_status, now, check_result, now, account_id),
        )
        conn.commit()
        cursor.close()
        conn.close()
    except Exception as exc:
        logger.error("更新账号刷新状态失败: %s", exc)


def detect_subscription_type(workspaces: List[Dict[str, Any]]) -> Optional[str]:
    plan_types = {
        workspace.get("plan_type")
        for workspace in (workspaces or [])
        if workspace.get("plan_type")
    }
    has_plus = "plus" in plan_types
    has_team = "team" in plan_types

    if has_plus and has_team:
        return "plus_team"
    if has_team:
        return "team"
    if has_plus:
        return "plus"
    if "free" in plan_types:
        return "free"
    return None


def merge_workspace_tokens(
    existing_tokens: List[Dict[str, Any]],
    new_tokens: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    merged: List[Dict[str, Any]] = [
        token for token in (existing_tokens or []) if isinstance(token, dict)
    ]
    existing_index_by_workspace_id = {
        token.get("workspace_id"): index
        for index, token in enumerate(merged)
        if token.get("workspace_id")
    }

    for token in new_tokens or []:
        if not isinstance(token, dict):
            continue
        workspace_id = token.get("workspace_id")
        if not workspace_id:
            merged.append(token)
            continue

        existing_index = existing_index_by_workspace_id.get(workspace_id)
        if existing_index is None:
            existing_index_by_workspace_id[workspace_id] = len(merged)
            merged.append(token)
            continue

        existing_token = merged[existing_index]
        existing_is_free_personal = (
            str(existing_token.get("kind") or "").lower() == "personal"
            and str(existing_token.get("plan_type") or "").lower() == "free"
        )
        new_is_personal = str(token.get("kind") or "").lower() == "personal"
        if existing_is_free_personal and new_is_personal:
            merged[existing_index] = token

    return merged


def save_workspace_tokens_snapshot(
    database_url: str,
    account_id: int,
    workspaces: List[Dict[str, Any]],
    existing_workspace_tokens: List[Dict[str, Any]],
    team_workspace_id: Optional[str] = None,
    id_token: Optional[str] = None,
    replace_existing: bool = False,
    clear_team_state: bool = False,
) -> List[Dict[str, Any]]:
    merged_workspaces = [
        token for token in (workspaces or []) if isinstance(token, dict)
    ] if replace_existing else merge_workspace_tokens(existing_workspace_tokens, workspaces)
    subscription_type = detect_subscription_type(merged_workspaces)
    now = datetime.now()
    first_workspace = merged_workspaces[0] if merged_workspaces else {}

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
                subscription_type = %s,
                team_workspace_id = CASE WHEN %s THEN NULL ELSE COALESCE(%s, team_workspace_id) END,
                team_member_count = CASE WHEN %s THEN NULL ELSE team_member_count END,
                team_members = CASE WHEN %s THEN '[]'::jsonb ELSE team_members END,
                team_members_refreshed_at = CASE WHEN %s THEN NULL ELSE team_members_refreshed_at END,
                status = 'active',
                health_status = 'healthy',
                last_checked_at = %s,
                last_check_result = NULL,
                updated_at = %s
            WHERE id = %s
            """,
            (
                first_workspace.get("access_token", ""),
                first_workspace.get("refresh_token", ""),
                id_token or first_workspace.get("id_token", ""),
                first_workspace.get("account_id") or first_workspace.get("workspace_id", ""),
                json.dumps(merged_workspaces),
                subscription_type,
                clear_team_state,
                team_workspace_id,
                clear_team_state,
                clear_team_state,
                clear_team_state,
                now,
                now,
                account_id,
            ),
        )
        conn.commit()
    finally:
        cursor.close()
        conn.close()

    logger.info("已保存 workspace tokens 快照: account_id=%s count=%s", account_id, len(merged_workspaces))
    return merged_workspaces


def extract_tokens_for_account(
    database_url: str,
    account_id: int,
    moemail_email_id: Optional[str] = None,
    proxy_url: Optional[str] = None,
) -> Dict[str, Any]:
    conn = _connect(database_url)
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    cursor.execute(
        """
        SELECT
            a.id,
            a.email,
            a.password,
            a.access_token,
            a.refresh_token,
            a.id_token,
            a.workspace_tokens,
            a.email_service_id AS stored_moemail_email_id
        FROM chatgpt_accounts a
        WHERE a.id = %s
        """,
        (account_id,),
    )
    account = cursor.fetchone()
    cursor.close()
    conn.close()

    if not account:
        raise ChatGPTTokenExtractionError("账号不存在", 404)

    email = account["email"]
    password = account["password"]
    if not email or not password:
        update_chatgpt_account_refresh_status(
            database_url,
            account_id,
            "abnormal",
            "invalid",
            "账号缺少邮箱或密码信息",
        )
        raise ChatGPTTokenExtractionError("账号缺少邮箱或密码信息", 400)

    resolved_moemail_email_id = moemail_email_id or account.get("stored_moemail_email_id")
    if not resolved_moemail_email_id:
        update_chatgpt_account_refresh_status(
            database_url,
            account_id,
            "abnormal",
            "invalid",
            "账号缺少 MoeMail 邮箱 ID",
        )
        raise ChatGPTTokenExtractionError("账号缺少 MoeMail 邮箱 ID", 400)

    moemail_provider = _get_moemail_provider(database_url)
    moemail_api = moemail_provider["api_url"]
    moemail_api_key = moemail_provider["api_key"]
    existing_workspace_tokens = account.get("workspace_tokens") or []
    if isinstance(existing_workspace_tokens, str):
        try:
            existing_workspace_tokens = json.loads(existing_workspace_tokens)
        except Exception:
            existing_workspace_tokens = []
    if not isinstance(existing_workspace_tokens, list):
        existing_workspace_tokens = []

    extractor = TokenExtractor(
        email=email,
        password=password,
        moemail_api=moemail_api,
        moemail_api_key=moemail_api_key,
        moemail_email_id=resolved_moemail_email_id,
        proxy=proxy_url,
        existing_workspace_tokens=existing_workspace_tokens,
    )

    logger.info("开始提取账号 %s 的 tokens", email)
    result = extractor.extract_account_tokens()
    if not result.success:
        update_chatgpt_account_refresh_status(
            database_url,
            account_id,
            "abnormal",
            "invalid",
            result.error_message or "刷新失败",
        )
        raise ChatGPTTokenExtractionError(result.error_message or "刷新失败", 500)

    saved_workspaces = save_workspace_tokens_snapshot(
        database_url=database_url,
        account_id=account_id,
        workspaces=result.workspaces,
        existing_workspace_tokens=existing_workspace_tokens,
        replace_existing=True,
        clear_team_state=True,
    )
    subscription_type = detect_subscription_type(saved_workspaces)

    logger.info("成功提取并保存账号 tokens: account_id=%s", account_id)
    return {
        "success": True,
        "message": "成功刷新账号 tokens",
        "subscription_type": subscription_type,
        "workspaces": saved_workspaces,
    }
