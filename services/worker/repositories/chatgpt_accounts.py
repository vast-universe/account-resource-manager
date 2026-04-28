"""Repository for ChatGPT account persistence.

This module intentionally keeps SQL out of workflow/service code. The current
schema is still ChatGPT-specific; this repository gives us a migration path
toward a generic resource account model later.
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

import psycopg2
from psycopg2.extras import RealDictCursor


class ChatGPTAccountRepository:
    """Small DB boundary for ChatGPT account reads/writes."""

    def __init__(self, database_url: str):
        self.database_url = database_url

    def _connect(self):
        return psycopg2.connect(self.database_url)

    def list_active_accounts(self, account_ids: Optional[List[int]] = None) -> List[Dict[str, Any]]:
        selected_ids = [int(account_id) for account_id in (account_ids or []) if account_id]
        selected_filter = ""
        params: List[Any] = []
        if selected_ids:
            selected_filter = "AND id = ANY(%s)"
            params.append(selected_ids)

        conn = self._connect()
        try:
            with conn.cursor(cursor_factory=RealDictCursor) as cursor:
                cursor.execute(
                    f"""
                    SELECT
                        id, email, access_token, account_id, password, email_service_id,
                        subscription_type, workspace_tokens, team_workspace_id, team_member_count,
                        team_members, team_members_refreshed_at
                    FROM chatgpt_accounts
                    WHERE deleted_at IS NULL
                      AND status = 'active'
                      AND email IS NOT NULL
                      {selected_filter}
                    ORDER BY created_at ASC
                    """,
                    params,
                )
                return [dict(row) for row in cursor.fetchall()]
        finally:
            conn.close()

    def get_account(self, account_id: int) -> Optional[Dict[str, Any]]:
        accounts = self.list_accounts_by_ids([account_id])
        return accounts[0] if accounts else None

    def list_accounts_by_ids(self, account_ids: List[int]) -> List[Dict[str, Any]]:
        selected_ids = [int(account_id) for account_id in account_ids if account_id]
        if not selected_ids:
            return []

        conn = self._connect()
        try:
            with conn.cursor(cursor_factory=RealDictCursor) as cursor:
                cursor.execute(
                    """
                    SELECT
                        id, email, access_token, account_id, password, email_service_id,
                        subscription_type, workspace_tokens, team_workspace_id, team_member_count,
                        team_members, team_members_refreshed_at
                    FROM chatgpt_accounts
                    WHERE deleted_at IS NULL
                      AND id = ANY(%s)
                    ORDER BY created_at ASC
                    """,
                    (selected_ids,),
                )
                return [dict(row) for row in cursor.fetchall()]
        finally:
            conn.close()

    def update_team_members(
        self,
        account_id: int,
        member_count: int,
        members: List[Dict[str, Any]],
    ) -> None:
        conn = self._connect()
        try:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    UPDATE chatgpt_accounts
                    SET
                        team_member_count = %s,
                        team_members = %s,
                        team_members_refreshed_at = NOW(),
                        updated_at = NOW()
                    WHERE id = %s AND deleted_at IS NULL
                    """,
                    (member_count, json.dumps(members), account_id),
                )
            conn.commit()
        finally:
            conn.close()
