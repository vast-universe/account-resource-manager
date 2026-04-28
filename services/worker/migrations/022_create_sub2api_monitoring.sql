-- Sub2API 分组阈值与本地账号上传绑定记录
CREATE TABLE IF NOT EXISTS sub2api_group_settings (
    site_id BIGINT NOT NULL REFERENCES sub2api_sites(id) ON DELETE CASCADE,
    group_id BIGINT NOT NULL,
    group_name TEXT NOT NULL DEFAULT '',
    threshold_available INTEGER NOT NULL DEFAULT 0,
    last_account_count INTEGER,
    last_available_count INTEGER,
    last_rate_limited_count INTEGER,
    last_checked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (site_id, group_id)
);

CREATE TABLE IF NOT EXISTS chatgpt_sub2api_uploads (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    account_id BIGINT NOT NULL REFERENCES chatgpt_accounts(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL,
    workspace_name TEXT NOT NULL DEFAULT '',
    site_id BIGINT NOT NULL REFERENCES sub2api_sites(id) ON DELETE CASCADE,
    group_id BIGINT NOT NULL,
    remote_account_id BIGINT,
    remote_account_name TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'failed')),
    error_message TEXT,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (account_id, workspace_id, site_id, group_id)
);

CREATE INDEX IF NOT EXISTS idx_chatgpt_sub2api_uploads_account
    ON chatgpt_sub2api_uploads(account_id, uploaded_at DESC);

CREATE INDEX IF NOT EXISTS idx_chatgpt_sub2api_uploads_site_group
    ON chatgpt_sub2api_uploads(site_id, group_id, status);

COMMENT ON TABLE sub2api_group_settings IS 'Sub2API 分组监控阈值';
COMMENT ON TABLE chatgpt_sub2api_uploads IS '本地 ChatGPT workspace token 上传到 Sub2API 站点分组的绑定记录';
