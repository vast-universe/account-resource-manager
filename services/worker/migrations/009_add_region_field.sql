-- 添加地区字段到 chatgpt_accounts 表
ALTER TABLE chatgpt_accounts
ADD COLUMN IF NOT EXISTS region VARCHAR(50);

COMMENT ON COLUMN chatgpt_accounts.region IS '账号注册地区 (如: US, DE, GB 等)';

-- 创建索引以便按地区查询
CREATE INDEX IF NOT EXISTS idx_chatgpt_accounts_region ON chatgpt_accounts(region)
WHERE deleted_at IS NULL AND region IS NOT NULL;
