CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO app_settings (key, value)
VALUES ('proxy.enabled', 'true')
ON CONFLICT (key) DO NOTHING;

COMMENT ON TABLE app_settings IS '系统级配置表';
COMMENT ON COLUMN app_settings.key IS '配置键';
COMMENT ON COLUMN app_settings.value IS '配置值';
