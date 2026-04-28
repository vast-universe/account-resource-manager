-- 创建代理配置表
CREATE TABLE IF NOT EXISTS proxies (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    public_id UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_proxies_active ON proxies(is_active) WHERE deleted_at IS NULL;
CREATE INDEX idx_proxies_created ON proxies(created_at DESC) WHERE deleted_at IS NULL;

COMMENT ON TABLE proxies IS '代理配置表';
COMMENT ON COLUMN proxies.name IS '代理名称';
COMMENT ON COLUMN proxies.url IS '代理地址';
COMMENT ON COLUMN proxies.is_active IS '是否启用';
