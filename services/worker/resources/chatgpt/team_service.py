"""ChatGPT Team business services.

This module owns Team-specific behavior. It depends on repositories and
integration clients, which keeps workflows thin and makes future providers
easier to add.
"""

from __future__ import annotations

import logging
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Callable, Dict, List, Optional

from integrations.chatgpt_api_client import ChatGPTApiClient
from integrations.moemail_client import MoeMailClient
from repositories.chatgpt_accounts import ChatGPTAccountRepository
from resources.chatgpt.workspaces import find_team_workspace, load_workspace_tokens

logger = logging.getLogger(__name__)


def extract_users(payload: Any) -> List[Any]:
    if not payload or not isinstance(payload, dict):
        return []
    for key in ["users", "items", "data", "results", "members"]:
        value = payload.get(key)
        if isinstance(value, list):
            return value
    return []


def normalize_user(user: Any) -> Dict[str, Any]:
    if not isinstance(user, dict):
        return {"raw": user}

    nested_user = user.get("user") if isinstance(user.get("user"), dict) else {}
    return {
        "id": user.get("id") or user.get("user_id") or user.get("account_user_id") or nested_user.get("id") or "",
        "account_user_id": user.get("account_user_id") or "",
        "email": user.get("email") or nested_user.get("email") or "",
        "name": user.get("name") or nested_user.get("name") or "",
        "role": user.get("role") or user.get("account_role") or "",
        "seat_type": user.get("seat_type") or "",
        "status": user.get("status") or user.get("invitation_status") or "",
        "created_time": user.get("created_time") or "",
        "raw": user,
    }


def normalize_email(email: Any) -> str:
    return str(email or "").strip().lower()


def has_team_subscription(account: Dict[str, Any]) -> bool:
    return "team" in str(account.get("subscription_type") or "").strip().lower()


def build_balanced_groups(accounts: List[Dict[str, Any]], max_group_size: int = 5) -> List[List[Dict[str, Any]]]:
    if len(accounts) < 2:
        return []

    groups = []
    for index in range(0, len(accounts), max_group_size):
        group = accounts[index:index + max_group_size]
        if len(group) >= 2:
            groups.append(group)
    return groups


def account_member_emails(account: Dict[str, Any]) -> set[str]:
    summary = account.get("_realtime_member_summary")
    if isinstance(summary, dict) and isinstance(summary.get("emails"), set):
        return summary["emails"]
    return set()


def account_email(account: Dict[str, Any]) -> str:
    return normalize_email(account.get("email"))


def pack_group_units(units: List[List[Dict[str, Any]]], max_group_size: int = 5) -> List[List[Dict[str, Any]]]:
    groups: List[List[Dict[str, Any]]] = []
    current: List[Dict[str, Any]] = []

    for unit in units:
        if not unit:
            continue
        if len(unit) > max_group_size:
            if len(current) >= 2:
                groups.append(current)
                current = []
            groups.extend(build_balanced_groups(unit, max_group_size=max_group_size))
            continue

        if current and len(current) + len(unit) > max_group_size:
            if len(current) >= 2:
                groups.append(current)
            current = []

        current.extend(unit)

    if len(current) >= 2:
        groups.append(current)

    return groups


def build_mutual_bind_groups(accounts: List[Dict[str, Any]], max_group_size: int = 5) -> List[List[Dict[str, Any]]]:
    clean_accounts = [
        account
        for account in accounts
        if account_group_member_count(account) <= 1
    ]
    partial_accounts = [
        account
        for account in accounts
        if account_group_member_count(account) > 1
    ]
    assigned_ids: set[int] = set()
    partial_units: List[List[Dict[str, Any]]] = []

    for partial_account in partial_accounts:
        partial_id = int(partial_account.get("id") or 0)
        if partial_id in assigned_ids:
            continue

        group = [partial_account]
        assigned_ids.add(partial_id)

        while len(group) < max_group_size:
            group_emails = {account_email(account) for account in group}
            group_member_emails = set()
            for account in group:
                group_member_emails.update(account_member_emails(account))

            related_candidates = [
                account
                for account in accounts
                if int(account.get("id") or 0) not in assigned_ids
                and (
                    account_email(account) in group_member_emails
                    or bool(account_member_emails(account) & group_emails)
                )
            ]
            if not related_candidates:
                break

            related_candidates.sort(key=lambda item: (account_group_member_count(item), int(item.get("id") or 0)))
            next_account = related_candidates[0]
            group.append(next_account)
            assigned_ids.add(int(next_account.get("id") or 0))

        if len(group) >= 2:
            partial_units.append(group)
        else:
            assigned_ids.discard(partial_id)

    groups = []
    remaining_clean_accounts = [
        account
        for account in clean_accounts
        if int(account.get("id") or 0) not in assigned_ids
    ]
    full_clean_count = (len(remaining_clean_accounts) // max_group_size) * max_group_size
    for index in range(0, full_clean_count, max_group_size):
        group = remaining_clean_accounts[index:index + max_group_size]
        if len(group) == max_group_size:
            groups.append(group)

    unassigned_partial_accounts = [
        account
        for account in partial_accounts
        if int(account.get("id") or 0) not in assigned_ids
    ]
    tail_clean_accounts = remaining_clean_accounts[full_clean_count:]
    tail_units = [[account] for account in tail_clean_accounts] + partial_units + [
        [account] for account in unassigned_partial_accounts
    ]
    groups.extend(pack_group_units(tail_units, max_group_size=max_group_size))
    return groups


def account_team_member_count(account: Dict[str, Any]) -> int:
    try:
        return int(account.get("team_member_count") or 0)
    except Exception:
        return 0


def account_group_member_count(account: Dict[str, Any]) -> int:
    try:
        return int(account.get("_realtime_team_member_count"))
    except Exception:
        return account_team_member_count(account)


class ChatGPTTeamService:
    """Operations for a single ChatGPT Team workspace."""

    def __init__(
        self,
        repository: ChatGPTAccountRepository,
        api_client: ChatGPTApiClient,
        api_client_factory: Optional[Callable[[], ChatGPTApiClient]] = None,
    ):
        self.repository = repository
        self.api_client = api_client
        self.api_client_factory = api_client_factory

    def _new_api_client(self) -> ChatGPTApiClient:
        if self.api_client_factory:
            return self.api_client_factory()
        return ChatGPTApiClient(proxy=getattr(self.api_client, "proxy", "") or "")

    def _fork(self) -> "ChatGPTTeamService":
        return ChatGPTTeamService(
            self.repository,
            self._new_api_client(),
            api_client_factory=self.api_client_factory,
        )

    def prepare_mother_account(self, account: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        account_id = account["id"]
        email = account["email"]
        team_workspace_id = account.get("team_workspace_id")
        workspace_tokens = load_workspace_tokens(account.get("workspace_tokens"))

        if not team_workspace_id:
            logger.info("跳过 %s: 未刷新记录母号 Team 空间 ID", email)
            return None

        team_workspace = find_team_workspace(workspace_tokens, team_workspace_id)
        if not team_workspace:
            logger.warning("跳过 %s: team_workspace_id 不在 workspace_tokens 中，请先刷新账号", email)
            return None

        if not team_workspace.get("access_token"):
            logger.warning("跳过 %s: 母号 Team 空间缺少 access_token，请先刷新账号", email)
            return None

        return {
            **account,
            "id": account_id,
            "workspace_tokens": workspace_tokens,
            "team_workspace_id": team_workspace.get("workspace_id"),
            "team_access_token": team_workspace.get("access_token"),
        }

    def send_invitation(self, mother_account: Dict[str, Any], invited_account: Dict[str, Any]) -> bool:
        mother_email = mother_account["email"]
        invited_email = invited_account["email"]
        result = self.api_client.send_team_invitation(
            mother_email=mother_email,
            access_token=mother_account.get("team_access_token") or "",
            account_id=mother_account.get("team_workspace_id") or "",
            invited_email=invited_email,
        )
        if result.ok:
            return True

        logger.warning(
            "邀请失败: %s -> %s | HTTP %s | %s",
            invited_email,
            mother_email,
            result.status_code,
            result.error or result.payload,
        )
        return False

    def invite_and_accept(
        self,
        mother_account: Dict[str, Any],
        invited_accounts: List[Dict[str, Any]],
        moemail_client: MoeMailClient,
        accept_invites: bool = True,
    ) -> Dict[str, Any]:
        sent_after_ms = int(time.time() * 1000)
        results = []
        logger.info(
            "[TeamInvite] 开始邀请流程: mother=%s team_workspace_id=%s targets=%s accept=%s sent_after_ms=%s",
            mother_account.get("email"),
            mother_account.get("team_workspace_id"),
            len(invited_accounts),
            accept_invites,
            sent_after_ms,
        )

        for invited_account in invited_accounts:
            email = invited_account.get("email", "")
            logger.info(
                "[TeamInvite] 处理被邀账号: id=%s email=%s moemail_id=%s",
                invited_account.get("id"),
                email,
                invited_account.get("email_service_id") or "-",
            )
            result = {
                "id": invited_account.get("id"),
                "email": email,
                "invited": False,
                "accepted": False,
                "error": "",
            }

            if not email:
                result["error"] = "账号缺少邮箱"
                results.append(result)
                continue

            if not self.send_invitation(mother_account, invited_account):
                result["error"] = "发送邀请失败"
                logger.info("[TeamInvite] 发送邀请失败: email=%s", email)
                results.append(result)
                continue

            result["invited"] = True
            logger.info("[TeamInvite] 发送邀请成功，等待接受: email=%s accept=%s", email, accept_invites)
            if not accept_invites:
                results.append(result)
                continue

            email_service_id = invited_account.get("email_service_id")
            if not email_service_id:
                result["error"] = "缺少 MoeMail 邮箱 ID"
                logger.info("[TeamInvite] 被邀账号缺少 MoeMail ID: email=%s", email)
                results.append(result)
                continue

            invite_url = moemail_client.wait_for_invite_url(str(email_service_id), sent_after_ms)
            if not invite_url:
                result["error"] = "未收到邀请邮件"
                logger.info("[TeamInvite] 未收到邀请邮件: email=%s moemail_id=%s", email, email_service_id)
                results.append(result)
                continue

            logger.info("[TeamInvite] 已获取邀请链接，开始访问: email=%s", email)
            accept_result = self.api_client.visit_invite_url(invite_url)
            result["accepted"] = accept_result.ok
            result["accept_status"] = accept_result.status_code
            if isinstance(accept_result.payload, dict):
                result["accepted_without_login"] = bool(accept_result.payload.get("accepted_without_login"))
            if not accept_result.ok:
                result["error"] = accept_result.error or "接受邀请失败"
                logger.info(
                    "[TeamInvite] 接受邀请失败: email=%s status=%s error=%s payload=%s",
                    email,
                    accept_result.status_code,
                    accept_result.error,
                    accept_result.payload,
                )
            else:
                logger.info("[TeamInvite] 接受邀请请求成功: email=%s status=%s", email, accept_result.status_code)
            results.append(result)

        invited_count = sum(1 for result in results if result.get("invited"))
        accepted_count = sum(1 for result in results if result.get("accepted"))
        logger.info(
            "[TeamInvite] 邀请流程完成: mother=%s invited=%s accepted=%s",
            mother_account.get("email"),
            invited_count,
            accepted_count,
        )

        return {
            "success": True,
            "mother_account_id": mother_account.get("id"),
            "results": results,
            "accepted_count": accepted_count,
            "team_member_count": mother_account.get("team_member_count"),
            "members_synced": False,
        }

    def invite_account_ids(
        self,
        mother_account_id: int,
        target_account_ids: List[int],
        moemail_client: MoeMailClient,
        accept_invites: bool = True,
    ) -> Dict[str, Any]:
        mother_account = self.repository.get_account(mother_account_id)
        if not mother_account:
            return {"success": False, "message": "母号不存在"}

        prepared_mother = self.prepare_mother_account(mother_account)
        if not prepared_mother:
            return {"success": False, "message": "母号未记录可用 Team 空间"}

        target_accounts = [
            account
            for account in self.repository.list_accounts_by_ids(target_account_ids)
            if int(account.get("id", 0)) != int(mother_account_id)
        ]
        if not target_accounts:
            return {"success": False, "message": "没有可邀请的账号"}

        result = self.invite_and_accept(
            mother_account=prepared_mother,
            invited_accounts=target_accounts,
            moemail_client=moemail_client,
            accept_invites=accept_invites,
        )
        member_summary = self.sync_members(prepared_mother)
        if member_summary.get("ok"):
            users = member_summary.get("users") or []
            member_count = int(member_summary.get("total") or len(users))
            self.repository.update_team_members(
                int(prepared_mother.get("id") or 0),
                member_count,
                users,
            )
            result["team_member_count"] = member_count
            result["members_synced"] = True
        else:
            result["members_synced"] = False
            result["members_sync_error"] = member_summary.get("error") or "同步成员失败"
        return result

    def sync_members(
        self,
        mother_account: Dict[str, Any],
        offset: int = 0,
        limit: int = 25,
        query: str = "",
    ) -> Dict[str, Any]:
        workspace_id = mother_account.get("team_workspace_id") or ""
        access_token = mother_account.get("team_access_token") or ""
        result = self.api_client.list_team_members(workspace_id, access_token, offset=offset, limit=limit, query=query)

        if not result.ok:
            logger.warning(
                "查询 Team 成员失败: %s | HTTP %s | %s",
                mother_account.get("email"),
                result.status_code,
                result.error,
            )
            return {
                "ok": False,
                "status": result.status_code,
                "users": [],
                "total": 0,
                "error": result.error,
                "raw": result.payload,
            }

        users = [normalize_user(user) for user in extract_users(result.payload)]
        total = len(users)
        if isinstance(result.payload, dict) and "total" in result.payload:
            try:
                total = int(result.payload["total"])
            except Exception:
                total = len(users)

        return {
            "ok": True,
            "status": result.status_code,
            "users": users,
            "total": total,
            "raw": result.payload,
        }

    def fetch_members_realtime(
        self,
        mother_account: Dict[str, Any],
        offset: int = 0,
        limit: int = 25,
        query: str = "",
    ) -> Dict[str, Any]:
        workspace_id = mother_account.get("team_workspace_id") or ""
        access_token = mother_account.get("team_access_token") or ""
        result = self.api_client.list_team_members(workspace_id, access_token, offset=offset, limit=limit, query=query)

        if not result.ok:
            return {
                "ok": False,
                "status": result.status_code,
                "users": [],
                "total": 0,
                "emails": set(),
                "error": result.error,
                "raw": result.payload,
            }

        users = [normalize_user(user) for user in extract_users(result.payload)]
        total = len(users)
        if isinstance(result.payload, dict) and "total" in result.payload:
            try:
                total = int(result.payload["total"])
            except Exception:
                total = len(users)

        return {
            "ok": True,
            "status": result.status_code,
            "users": users,
            "total": total,
            "emails": {normalize_email(user.get("email")) for user in users if user.get("email")},
            "raw": result.payload,
        }

    def mutual_bind_account_ids(
        self,
        account_ids: List[int],
        moemail_client: MoeMailClient,
        accept_invites: bool = True,
        max_group_size: int = 5,
        max_workers: int = 1,
        moemail_client_factory: Optional[Callable[[], MoeMailClient]] = None,
    ) -> Dict[str, Any]:
        selected_ids = list(dict.fromkeys(int(account_id) for account_id in (account_ids or []) if account_id))
        if len(selected_ids) < 2:
            return {"success": False, "message": "请至少选择 2 个账号"}

        accounts = sorted(self.repository.list_accounts_by_ids(selected_ids), key=lambda item: int(item.get("id") or 0))
        if len(accounts) < 2:
            return {"success": False, "message": "可处理账号不足，至少需要 2 个"}

        max_workers = max(1, min(int(max_workers or 1), 8))
        eligible_candidates = []
        skipped_accounts = []
        for account in accounts:
            if not has_team_subscription(account):
                skipped_accounts.append({
                    "id": account.get("id"),
                    "email": account.get("email"),
                    "reason": "账号不是 Team 订阅",
                })
                continue

            prepared_account = self.prepare_mother_account(account)
            if not prepared_account:
                skipped_accounts.append({
                    "id": account.get("id"),
                    "email": account.get("email"),
                    "reason": "缺少可用母号 Team 空间或 token，请先刷新账号",
                })
                continue

            eligible_candidates.append(prepared_account)

        def fetch_member_summary(prepared_account: Dict[str, Any]) -> tuple[Dict[str, Any], Dict[str, Any]]:
            service = self._fork() if max_workers > 1 else self
            return prepared_account, service.fetch_members_realtime(prepared_account)

        eligible_accounts = []
        if max_workers > 1 and len(eligible_candidates) > 1:
            logger.info(
                "[TeamMutualBind] 并发预查询成员: accounts=%s workers=%s",
                len(eligible_candidates),
                min(max_workers, len(eligible_candidates)),
            )
            with ThreadPoolExecutor(max_workers=min(max_workers, len(eligible_candidates))) as executor:
                future_map = {
                    executor.submit(fetch_member_summary, prepared_account): prepared_account
                    for prepared_account in eligible_candidates
                }
                member_items = []
                for future in as_completed(future_map):
                    member_items.append(future.result())
            member_items.sort(key=lambda item: int(item[0].get("id") or 0))
        else:
            member_items = [fetch_member_summary(prepared_account) for prepared_account in eligible_candidates]

        for prepared_account, member_summary in member_items:
            logger.info(
                "[TeamMutualBind] 预查询成员: mother=%s ok=%s total=%s error=%s",
                prepared_account.get("email"),
                member_summary.get("ok"),
                member_summary.get("total"),
                member_summary.get("error") or "",
            )
            if not member_summary.get("ok"):
                skipped_accounts.append({
                    "id": prepared_account.get("id"),
                    "email": prepared_account.get("email"),
                    "reason": member_summary.get("error") or "实时查询 Team 成员失败",
                })
                continue

            realtime_member_count = int(member_summary.get("total") or 0)
            if realtime_member_count >= max_group_size:
                skipped_accounts.append({
                    "id": prepared_account.get("id"),
                    "email": prepared_account.get("email"),
                    "reason": f"实时查询 Team 已满（{realtime_member_count}/{max_group_size}）",
                })
                continue

            prepared_account["_realtime_team_member_count"] = realtime_member_count
            prepared_account["_realtime_member_summary"] = member_summary
            eligible_accounts.append(prepared_account)

        if len(eligible_accounts) < 2:
            return {
                "success": False,
                "message": "可参与互拉的 Team 账号不足，至少需要 2 个",
                "eligible_count": len(eligible_accounts),
                "skipped_accounts": skipped_accounts,
            }

        sorted_eligible_accounts = sorted(
            eligible_accounts,
            key=lambda item: (account_group_member_count(item), int(item.get("id") or 0)),
        )
        groups = build_mutual_bind_groups(sorted_eligible_accounts, max_group_size=max_group_size)
        grouped_ids = {int(account.get("id") or 0) for group in groups for account in group}
        ungrouped_accounts = [
            {
                "id": account.get("id"),
                "email": account.get("email"),
                "reason": "剩余 1 个账号不足成组",
            }
            for account in eligible_accounts
            if int(account.get("id") or 0) not in grouped_ids
        ]
        all_group_results = []
        total_actions = 0
        total_skipped_existing = 0
        total_skipped_full = 0
        total_success = 0
        total_failed = 0
        incomplete_teams = []

        def process_group(group_index: int, group: List[Dict[str, Any]]) -> Dict[str, Any]:
            logger.info("[TeamMutualBind] 处理第 %s 组: %s", group_index, [item.get("email") for item in group])
            group_member_summaries: Dict[int, Dict[str, Any]] = {}
            group_skipped = []
            group_results = []
            invite_jobs = []
            counters = {
                "actions": 0,
                "skipped_existing": 0,
                "skipped_full": 0,
                "success": 0,
                "failed": 0,
            }

            for mother_account in group:
                member_service = self._fork() if max_workers > 1 else self
                account_id = int(mother_account.get("id") or 0)
                member_summary = mother_account.get("_realtime_member_summary")
                if not isinstance(member_summary, dict):
                    member_summary = member_service.fetch_members_realtime(mother_account)
                group_member_summaries[account_id] = member_summary
                logger.info(
                    "[TeamMutualBind] 使用成员快照: group=%s mother=%s ok=%s total=%s error=%s",
                    group_index,
                    mother_account.get("email"),
                    member_summary.get("ok"),
                    member_summary.get("total"),
                    member_summary.get("error") or "",
                )

            for mother_account in group:
                mother_id = int(mother_account.get("id") or 0)
                member_summary = group_member_summaries.get(mother_id) or {}
                if not member_summary.get("ok"):
                    counters["failed"] += len(group) - 1
                    for target_account in group:
                        if int(target_account.get("id") or 0) == mother_id:
                            continue
                        group_results.append({
                            "group_index": group_index,
                            "mother_account_id": mother_id,
                            "mother_email": mother_account.get("email"),
                            "target_account_id": target_account.get("id"),
                            "target_email": target_account.get("email"),
                            "invited": False,
                            "accepted": False,
                            "error": member_summary.get("error") or "母号成员查询失败，已跳过",
                        })
                    continue

                existing_emails = member_summary.get("emails") or set()
                realtime_member_count = int(member_summary.get("total") or 0)
                available_slots = max(0, max_group_size - realtime_member_count)
                if available_slots <= 0:
                    for target_account in group:
                        target_id = int(target_account.get("id") or 0)
                        if target_id == mother_id:
                            continue
                        counters["skipped_full"] += 1
                        group_skipped.append({
                            "group_index": group_index,
                            "mother_account_id": mother_id,
                            "mother_email": mother_account.get("email"),
                            "target_account_id": target_id,
                            "target_email": target_account.get("email"),
                            "reason": "team_full",
                        })
                    continue

                invited_accounts = []
                for target_account in group:
                    target_id = int(target_account.get("id") or 0)
                    if target_id == mother_id:
                        continue
                    if normalize_email(target_account.get("email")) in existing_emails:
                        counters["skipped_existing"] += 1
                        group_skipped.append({
                            "group_index": group_index,
                            "mother_account_id": mother_id,
                            "mother_email": mother_account.get("email"),
                            "target_account_id": target_id,
                            "target_email": target_account.get("email"),
                            "reason": "already_member",
                        })
                        continue
                    invited_accounts.append(target_account)
                    if len(invited_accounts) >= available_slots:
                        break

                for target_account in invited_accounts:
                    invite_jobs.append({
                        "mother_account": mother_account,
                        "target_account": target_account,
                    })

            def apply_invite_item(mother_account: Dict[str, Any], item: Dict[str, Any]) -> None:
                mother_id = int(mother_account.get("id") or 0)
                counters["actions"] += 1
                ok = bool(item.get("invited") and (item.get("accepted") or not accept_invites))
                if ok:
                    counters["success"] += 1
                else:
                    counters["failed"] += 1
                group_results.append({
                    "group_index": group_index,
                    "mother_account_id": mother_id,
                    "mother_email": mother_account.get("email"),
                    "target_account_id": item.get("id"),
                    "target_email": item.get("email"),
                    "invited": item.get("invited", False),
                    "accepted": item.get("accepted", False),
                    "error": item.get("error") or "",
                })

            def run_invite_job(job: Dict[str, Any]) -> tuple[Dict[str, Any], List[Dict[str, Any]]]:
                service = self._fork() if max_workers > 1 else self
                mail_client = moemail_client_factory() if moemail_client_factory and max_workers > 1 else moemail_client
                invite_result = service.invite_and_accept(
                    mother_account=job["mother_account"],
                    invited_accounts=[job["target_account"]],
                    moemail_client=mail_client,
                    accept_invites=accept_invites,
                )
                return job["mother_account"], [
                    item for item in invite_result.get("results", []) if isinstance(item, dict)
                ]

            round_index = 0
            while invite_jobs:
                round_index += 1
                used_mother_ids = set()
                used_target_emails = set()
                round_jobs = []
                remaining_jobs = []

                for job in invite_jobs:
                    mother_id = int(job["mother_account"].get("id") or 0)
                    target_email = normalize_email(job["target_account"].get("email"))
                    if mother_id in used_mother_ids or target_email in used_target_emails:
                        remaining_jobs.append(job)
                        continue

                    used_mother_ids.add(mother_id)
                    used_target_emails.add(target_email)
                    round_jobs.append(job)

                logger.info(
                    "[TeamMutualBind] 并发互拉轮次: group=%s round=%s jobs=%s",
                    group_index,
                    round_index,
                    len(round_jobs),
                )
                if max_workers > 1 and len(round_jobs) > 1:
                    with ThreadPoolExecutor(max_workers=min(max_workers, len(round_jobs))) as executor:
                        futures = [executor.submit(run_invite_job, job) for job in round_jobs]
                        round_results = [future.result() for future in as_completed(futures)]
                else:
                    round_results = [run_invite_job(job) for job in round_jobs]

                round_results.sort(key=lambda item: int(item[0].get("id") or 0))
                for mother_account, items in round_results:
                    for item in items:
                        apply_invite_item(mother_account, item)

                invite_jobs = remaining_jobs

            final_member_counts = []
            group_incomplete_teams = []
            expected_member_count = min(max_group_size, len(group))
            for mother_account in group:
                service = self._fork() if max_workers > 1 else self
                summary = service.fetch_members_realtime(mother_account)
                member_count = int(summary.get("total") or 0) if summary.get("ok") else 0
                users = summary.get("users") or []
                if summary.get("ok"):
                    self.repository.update_team_members(
                        int(mother_account.get("id") or 0),
                        member_count,
                        users,
                    )

                final_item = {
                    "account_id": mother_account.get("id"),
                    "email": mother_account.get("email"),
                    "team_workspace_id": mother_account.get("team_workspace_id"),
                    "ok": bool(summary.get("ok")),
                    "member_count": member_count,
                    "expected_member_count": expected_member_count,
                    "error": summary.get("error") or "",
                }
                final_member_counts.append(final_item)
                if not summary.get("ok") or member_count < expected_member_count:
                    group_incomplete_teams.append(final_item)

            return {
                "group_index": group_index,
                "accounts": [
                    {
                        "id": account.get("id"),
                        "email": account.get("email"),
                    }
                    for account in group
                ],
                "results": group_results,
                "skipped": group_skipped,
                "final_member_counts": final_member_counts,
                "incomplete_teams": group_incomplete_teams,
                "_counters": counters,
            }

        if max_workers > 1 and len(groups) > 1:
            logger.info(
                "[TeamMutualBind] 并发处理互拉分组: groups=%s workers=%s",
                len(groups),
                min(max_workers, len(groups)),
            )
            with ThreadPoolExecutor(max_workers=min(max_workers, len(groups))) as executor:
                futures = [
                    executor.submit(process_group, group_index, group)
                    for group_index, group in enumerate(groups, 1)
                ]
                all_group_results = [future.result() for future in as_completed(futures)]
            all_group_results.sort(key=lambda item: int(item.get("group_index") or 0))
        else:
            all_group_results = [
                process_group(group_index, group)
                for group_index, group in enumerate(groups, 1)
            ]

        for group_result in all_group_results:
            counters = group_result.pop("_counters", {})
            total_actions += int(counters.get("actions") or 0)
            total_skipped_existing += int(counters.get("skipped_existing") or 0)
            total_skipped_full += int(counters.get("skipped_full") or 0)
            total_success += int(counters.get("success") or 0)
            total_failed += int(counters.get("failed") or 0)
            incomplete_teams.extend([
                item
                for item in group_result.get("incomplete_teams", [])
                if isinstance(item, dict)
            ])

        return {
            "success": True,
            "selected_count": len(selected_ids),
            "eligible_count": len(eligible_accounts),
            "skipped_accounts": skipped_accounts,
            "ungrouped_accounts": ungrouped_accounts,
            "group_count": len(groups),
            "concurrency": max_workers,
            "groups": all_group_results,
            "total_actions": total_actions,
            "success_count": total_success,
            "failed_count": total_failed,
            "skipped_existing_count": total_skipped_existing,
            "skipped_full_count": total_skipped_full,
            "incomplete_team_count": len(incomplete_teams),
            "incomplete_teams": incomplete_teams,
        }

    def get_members(
        self,
        account_id: int,
        offset: int = 0,
        limit: int = 25,
        query: str = "",
    ) -> Dict[str, Any]:
        account = self.repository.get_account(account_id)
        if not account:
            return {"success": False, "message": "账号不存在", "status_code": 404}

        team_workspace_id = account.get("team_workspace_id") or ""
        if not team_workspace_id:
            return {
                "success": False,
                "message": "账号未记录母号 Team 空间 ID",
                "status_code": 400,
                "account_id": account.get("id"),
                "email": account.get("email"),
            }

        workspace_tokens = load_workspace_tokens(account.get("workspace_tokens"))
        team_workspace = find_team_workspace(workspace_tokens, team_workspace_id)

        prepared_account = self.prepare_mother_account(account)
        if not prepared_account:
            return {
                "success": False,
                "message": "母号 Team 空间缺少 access_token，请先重新提取 Tokens",
                "status_code": 400,
                "account_id": account.get("id"),
                "email": account.get("email"),
                "team_workspace_id": team_workspace_id,
            }

        member_summary = self.sync_members(prepared_account, offset=offset, limit=limit, query=query)
        if member_summary.get("ok"):
            users = member_summary.get("users") or []
            self.repository.update_team_members(
                int(account.get("id") or 0),
                int(member_summary.get("total") or len(users)),
                users,
            )
        workspace = {
            "workspace_id": team_workspace_id,
            "workspace_name": (team_workspace or {}).get("workspace_name") or team_workspace_id,
            "plan_type": (team_workspace or {}).get("plan_type") or "team",
            "status": member_summary.get("status", 0),
            "ok": member_summary.get("ok", False),
            "users": member_summary.get("users", []),
            "raw": member_summary.get("raw"),
        }
        if member_summary.get("error"):
            workspace["error"] = member_summary.get("error")

        return {
            "success": True,
            "account_id": account.get("id"),
            "email": account.get("email"),
            "team_workspace_id": team_workspace_id,
            "workspace": workspace,
        }
