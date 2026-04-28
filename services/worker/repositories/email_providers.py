"""Repository for email provider configuration."""

from __future__ import annotations

from typing import Any, Dict, Optional

import psycopg2
from psycopg2.extras import RealDictCursor


class EmailProviderRepository:
    def __init__(self, database_url: str):
        self.database_url = database_url

    def _connect(self):
        return psycopg2.connect(self.database_url)

    def get_default_provider(self, provider_type: str) -> Optional[Dict[str, Any]]:
        conn = self._connect()
        try:
            with conn.cursor(cursor_factory=RealDictCursor) as cursor:
                cursor.execute(
                    """
                    SELECT id, provider_type, name, api_url, api_key, status, is_default
                    FROM email_providers
                    WHERE provider_type = %s
                      AND status = 'active'
                      AND deleted_at IS NULL
                    ORDER BY is_default DESC, created_at DESC
                    LIMIT 1
                    """,
                    (provider_type,),
                )
                row = cursor.fetchone()
                return dict(row) if row else None
        finally:
            conn.close()

