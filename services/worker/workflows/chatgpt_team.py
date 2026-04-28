"""Workflow wrappers for ChatGPT Team operations."""

from __future__ import annotations

import logging
import os
import time
from typing import Callable, Dict, List, Optional

from workflows.chatgpt_extract_tokens import ChatGPTTokenExtractionError, extract_tokens_for_account
from integrations.chatgpt_api_client import ChatGPTApiClient
from integrations.moemail_client import MoeMailClient
from repositories.chatgpt_accounts import ChatGPTAccountRepository
from repositories.email_providers import EmailProviderRepository
from resources.chatgpt.team_service import ChatGPTTeamService

logger = logging.getLogger(__name__)


class ChatGPTTeamWorkflowError(Exception):
    def __init__(self, message: str, status_code: int = 500):
        super().__init__(message)
        self.status_code = status_code


def _create_moemail_client(database_url: str, required: bool = True) -> Optional[MoeMailClient]:
    provider = EmailProviderRepository(database_url).get_default_provider("moemail")
    if provider and provider.get("api_url") and provider.get("api_key"):
        return MoeMailClient(provider["api_url"], provider["api_key"])
    if required:
        raise ChatGPTTeamWorkflowError("未配置可用 MoeMail provider", 400)
    return None


def invite_team_members(
    database_url: str,
    mother_account_id: int,
    target_account_ids: List[int],
    accept_invites: bool,
    next_proxy: Callable[[], Optional[str]],
) -> Dict[str, object]:
    target_ids = [int(account_id) for account_id in (target_account_ids or []) if account_id]
    if not target_ids:
        raise ChatGPTTeamWorkflowError("请选择要邀请的账号", 400)

    repository = ChatGPTAccountRepository(database_url)
    proxy = next_proxy() or ""
    api_client = ChatGPTApiClient(proxy=proxy)
    team_service = ChatGPTTeamService(repository, api_client)
    moemail_client = _create_moemail_client(database_url, required=True)

    result = team_service.invite_account_ids(
        mother_account_id=mother_account_id,
        target_account_ids=target_ids,
        moemail_client=moemail_client,
        accept_invites=accept_invites,
    )
    if not result.get("success"):
        raise ChatGPTTeamWorkflowError(str(result.get("message") or "邀请失败"), 400)

    return result


def mutual_bind_team_members(
    database_url: str,
    account_ids: List[int],
    accept_invites: bool,
    next_proxy: Callable[[], Optional[str]],
    refresh_after: bool = True,
    concurrency: Optional[int] = None,
) -> Dict[str, object]:
    selected_ids = [int(account_id) for account_id in (account_ids or []) if account_id]
    if len(selected_ids) < 2:
        raise ChatGPTTeamWorkflowError("请至少选择 2 个账号", 400)

    repository = ChatGPTAccountRepository(database_url)
    api_client_factory = lambda: ChatGPTApiClient(proxy=next_proxy() or "")
    team_service = ChatGPTTeamService(repository, api_client_factory(), api_client_factory=api_client_factory)
    moemail_client = _create_moemail_client(database_url, required=True)
    moemail_client_factory = lambda: _create_moemail_client(database_url, required=True)
    try:
        worker_count = int(concurrency or os.getenv("TEAM_MUTUAL_BIND_CONCURRENCY", "2") or 1)
    except Exception:
        worker_count = 2

    result = team_service.mutual_bind_account_ids(
        account_ids=selected_ids,
        moemail_client=moemail_client,
        accept_invites=accept_invites,
        max_workers=worker_count,
        moemail_client_factory=moemail_client_factory,
    )
    if not result.get("success"):
        raise ChatGPTTeamWorkflowError(str(result.get("message") or "Team 互拉失败"), 400)

    if refresh_after:
        grouped_account_ids = []
        seen_ids = set()
        for group in result.get("groups", []):
            if not isinstance(group, dict):
                continue
            for account in group.get("accounts", []):
                if not isinstance(account, dict):
                    continue
                account_id = int(account.get("id") or 0)
                if account_id and account_id not in seen_ids:
                    seen_ids.add(account_id)
                    grouped_account_ids.append(account_id)

        refresh_results = []
        logger.info("[TeamMutualBind] 互拉完成，开始刷新 %s 个账号 tokens", len(grouped_account_ids))
        for index, account_id in enumerate(grouped_account_ids, 1):
            if index > 1:
                time.sleep(5)
            try:
                refresh_result = extract_tokens_for_account(
                    database_url=database_url,
                    account_id=account_id,
                    proxy_url=next_proxy() or None,
                )
                refresh_results.append({
                    "account_id": account_id,
                    "success": True,
                    "subscription_type": refresh_result.get("subscription_type"),
                    "workspace_count": len(refresh_result.get("workspaces") or []),
                })
                logger.info("[TeamMutualBind] tokens 刷新成功: account_id=%s", account_id)
            except ChatGPTTokenExtractionError as exc:
                refresh_results.append({
                    "account_id": account_id,
                    "success": False,
                    "error": str(exc),
                })
                logger.warning("[TeamMutualBind] tokens 刷新失败: account_id=%s error=%s", account_id, exc)
            except Exception as exc:
                refresh_results.append({
                    "account_id": account_id,
                    "success": False,
                    "error": str(exc),
                })
                logger.exception("[TeamMutualBind] tokens 刷新异常: account_id=%s", account_id)

        result["refresh_after"] = True
        result["refresh_results"] = refresh_results
        result["refresh_success_count"] = sum(1 for item in refresh_results if item.get("success"))
        result["refresh_failed_count"] = sum(1 for item in refresh_results if not item.get("success"))

    return result


def get_team_members(
    database_url: str,
    account_id: int,
    offset: int,
    limit: int,
    query: str,
    next_proxy: Callable[[], Optional[str]],
) -> Dict[str, object]:
    repository = ChatGPTAccountRepository(database_url)
    proxy = next_proxy() or ""
    api_client = ChatGPTApiClient(proxy=proxy)
    team_service = ChatGPTTeamService(repository, api_client)

    result = team_service.get_members(
        account_id=account_id,
        offset=offset,
        limit=limit,
        query=query,
    )
    if not result.get("success"):
        raise ChatGPTTeamWorkflowError(
            str(result.get("message") or "查询 Team 成员失败"),
            int(result.get("status_code") or 400),
        )
    result.pop("success", None)
    return result
