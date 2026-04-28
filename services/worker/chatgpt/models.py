"""ChatGPT workflow result models."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List


@dataclass
class TokenExtractionResult:
    """Token extraction result."""

    success: bool
    email: str = ""
    workspaces: List[Dict[str, Any]] = None
    error_message: str = ""

    def __post_init__(self):
        if self.workspaces is None:
            self.workspaces = []


@dataclass
class PaymentRegistrationResult:
    """Payment registration result."""

    success: bool
    email: str = ""
    password: str = ""
    access_token: str = ""
    refresh_token: str = ""
    id_token: str = ""
    session_token: str = ""
    account_id: str = ""
    checkout_url: str = ""
    team_checkout_url: str = ""
    email_service_id: str = ""
    region: str = ""
    error_message: str = ""
    source: str = "payment_register"

