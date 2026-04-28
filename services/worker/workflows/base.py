"""Base workflow contracts."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Protocol

from core.result import WorkflowResult


@dataclass
class WorkflowContext:
    task_id: str = ""
    database_url: str = ""
    proxy: str = ""
    dry_run: bool = False
    timeout_seconds: int = 300


class Workflow(Protocol):
    name: str

    def run(self, payload: Dict[str, Any], context: WorkflowContext) -> WorkflowResult:
        ...

