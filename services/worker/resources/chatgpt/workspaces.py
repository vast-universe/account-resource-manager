"""Workspace helpers for ChatGPT accounts."""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional


def load_workspace_tokens(raw_tokens: Any) -> List[Dict[str, Any]]:
    """Normalize workspace_tokens from Postgres JSON/JSONB/text into a list."""
    if not raw_tokens:
        return []
    if isinstance(raw_tokens, str):
        try:
            raw_tokens = json.loads(raw_tokens)
        except Exception:
            return []
    return raw_tokens if isinstance(raw_tokens, list) else []


def find_team_workspace(
    workspace_tokens: List[Dict[str, Any]],
    team_workspace_id: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    team_workspaces = [
        workspace
        for workspace in workspace_tokens
        if workspace.get("plan_type") == "team" and workspace.get("workspace_id")
    ]

    if team_workspace_id:
        for workspace in team_workspaces:
            if workspace.get("workspace_id") == team_workspace_id:
                return workspace

    if len(team_workspaces) == 1:
        return team_workspaces[0]

    return None

