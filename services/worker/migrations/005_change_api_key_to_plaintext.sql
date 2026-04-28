-- 将 api_key_ciphertext 改为 api_key (明文存储)
-- 注意：这会丢失现有的加密数据，需要重新配置 API key

-- 删除旧的加密字段
ALTER TABLE email_providers DROP COLUMN IF EXISTS api_key_ciphertext;

-- 添加新的明文字段
ALTER TABLE email_providers ADD COLUMN IF NOT EXISTS api_key TEXT;

-- 删除不再需要的 secret_version 字段
ALTER TABLE email_providers DROP COLUMN IF EXISTS secret_version;

COMMENT ON COLUMN email_providers.api_key IS 'API key (明文存储)';
