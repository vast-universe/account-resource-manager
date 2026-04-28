-- 创建 Sub2API 站点配置表
CREATE TABLE IF NOT EXISTS sub2api_sites (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    public_id UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    name TEXT NOT NULL,
    api_url TEXT NOT NULL,
    api_key TEXT NOT NULL,
    default_group_ids BIGINT[] NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    notes TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_sub2api_sites_name_active
    ON sub2api_sites(name)
    WHERE deleted_at IS NULL;

COMMENT ON TABLE sub2api_sites IS 'Sub2API 站点配置表';
COMMENT ON COLUMN sub2api_sites.name IS '站点名称';
COMMENT ON COLUMN sub2api_sites.api_url IS 'Sub2API API 地址';
COMMENT ON COLUMN sub2api_sites.api_key IS 'Sub2API 管理员 API Key';
COMMENT ON COLUMN sub2api_sites.default_group_ids IS '默认上传分组 ID';
COMMENT ON COLUMN sub2api_sites.status IS '站点状态';
