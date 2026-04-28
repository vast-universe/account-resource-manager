#!/usr/bin/env python3

import os
import sys
import unittest
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from workflows.chatgpt_export_sub2api import _build_sub2api_account, _format_batch_date


class Sub2ApiNamingTests(unittest.TestCase):
    def test_export_account_name_uses_date_card_type_and_sequence(self):
        account = _build_sub2api_account(
            "demo@example.com",
            {"workspace_id": "org-123", "plan_type": "team"},
            75,
            "4-23",
            "长效",
        )

        self.assertEqual(account["name"], "4-23-长效 #75")

    def test_export_account_name_defaults_to_short_card_type(self):
        account = _build_sub2api_account(
            "demo@example.com",
            {"workspace_id": "org-123", "plan_type": "team"},
            64,
            "4-23",
        )

        self.assertEqual(account["name"], "4-23-短效 #64")

    def test_export_date_uses_shanghai_day(self):
        reference = datetime(2026, 4, 23, 0, 0, tzinfo=timezone.utc)

        self.assertEqual(_format_batch_date(reference), "4-23")


if __name__ == "__main__":
    unittest.main()
