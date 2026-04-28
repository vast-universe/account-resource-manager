"""Shared result and error types for worker workflows."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class WorkerError:
    code: str
    message: str
    retryable: bool = False
    account_id: Optional[int] = None
    detail: Dict[str, Any] = field(default_factory=dict)


@dataclass
class WorkflowResult:
    success: bool
    message: str = ""
    data: Dict[str, Any] = field(default_factory=dict)
    errors: List[WorkerError] = field(default_factory=list)

