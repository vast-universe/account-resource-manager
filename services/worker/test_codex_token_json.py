#!/usr/bin/env python3

import base64
import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from chatgpt.auth_utils import build_workspace_token_result


def _jwt(payload):
    def encode(data):
        raw = json.dumps(data, separators=(",", ":")).encode("utf-8")
        return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")

    return f"{encode({'alg': 'none'})}.{encode(payload)}."


class CodexTokenJsonTests(unittest.TestCase):
    def test_workspace_token_includes_chatgpt_register_json_fields(self):
        access_token = _jwt(
            {
                "exp": 1800000000,
                "jti": "jti-123",
                "https://api.openai.com/auth": {
                    "chatgpt_account_id": "workspace-123",
                    "chatgpt_user_id": "user-123",
                    "chatgpt_plan_type": "plus",
                },
            }
        )

        token = build_workspace_token_result(
            {
                "email": "demo@example.com",
                "access_token": access_token,
                "refresh_token": "refresh-123",
                "id_token": "id-123",
            },
            [{"id": "workspace-123", "name": "Personal", "kind": "personal"}],
        )

        self.assertEqual(token["type"], "codex")
        self.assertEqual(token["email"], "demo@example.com")
        self.assertEqual(token["account_id"], "workspace-123")
        self.assertEqual(token["workspace_id"], "workspace-123")
        self.assertEqual(token["id_token"], "id-123")
        self.assertEqual(token["access_token"], access_token)
        self.assertEqual(token["refresh_token"], "refresh-123")
        self.assertTrue(token["expired"].endswith("+08:00"))
        self.assertTrue(token["last_refresh"].endswith("+08:00"))

    def test_existing_refresh_token_can_be_added_before_building_codex_json(self):
        access_token = _jwt(
            {
                "https://api.openai.com/auth": {
                    "chatgpt_account_id": "workspace-123",
                    "chatgpt_plan_type": "team",
                },
            }
        )

        token = build_workspace_token_result(
            {
                "email": "demo@example.com",
                "access_token": access_token,
                "refresh_token": "old-refresh",
            },
            [{"id": "workspace-123", "name": "Team", "kind": "workspace"}],
            expected_workspace_id="workspace-123",
        )

        self.assertEqual(token["type"], "codex")
        self.assertEqual(token["email"], "demo@example.com")
        self.assertEqual(token["refresh_token"], "old-refresh")
        self.assertEqual(token["account_id"], "workspace-123")
        self.assertEqual(token["workspace_id"], "workspace-123")


if __name__ == "__main__":
    unittest.main()
