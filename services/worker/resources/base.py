"""Base resource provider contracts.

Providers such as ChatGPT, Claude, or Gemini can implement only the
capabilities they support. Workflows should depend on these contracts instead
of direct provider-specific scripts.
"""

from __future__ import annotations

from typing import Any, Dict, List, Protocol

from core.result import WorkflowResult


class ResourceProvider(Protocol):
    name: str

    def refresh_account(self, account_id: int, context: Dict[str, Any]) -> WorkflowResult:
        ...

    def extract_tokens(self, account_id: int, context: Dict[str, Any]) -> WorkflowResult:
        ...

    def health_check(self, account_id: int, context: Dict[str, Any]) -> WorkflowResult:
        ...


class TeamCapableProvider(ResourceProvider, Protocol):
    def list_team_members(self, account_id: int, context: Dict[str, Any]) -> WorkflowResult:
        ...

    def invite_members(
        self,
        mother_account_id: int,
        target_account_ids: List[int],
        context: Dict[str, Any],
    ) -> WorkflowResult:
        ...

