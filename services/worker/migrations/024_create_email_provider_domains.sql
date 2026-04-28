CREATE TABLE IF NOT EXISTS email_provider_domains (
    provider_id BIGINT NOT NULL REFERENCES email_providers(id) ON DELETE CASCADE,
    domain TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'blocked')),
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    total_failures INTEGER NOT NULL DEFAULT 0,
    total_successes INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    last_used_at TIMESTAMPTZ,
    last_failed_at TIMESTAMPTZ,
    blocked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (provider_id, domain)
);

CREATE INDEX IF NOT EXISTS idx_email_provider_domains_provider_status
    ON email_provider_domains(provider_id, status, updated_at DESC);
