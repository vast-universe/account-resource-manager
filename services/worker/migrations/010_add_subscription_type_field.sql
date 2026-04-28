-- 添加订阅类型字段到 chatgpt_accounts 表
ALTER TABLE chatgpt_accounts
ADD COLUMN IF NOT EXISTS subscription_type VARCHAR(50);

COMMENT ON COLUMN chatgpt_accounts.subscription_type IS '订阅类型: free, plus, team, plus_team (两者都有)';

-- 创建索引以便按订阅类型查询
CREATE INDEX IF NOT EXISTS idx_chatgpt_accounts_subscription_type ON chatgpt_accounts(subscription_type)
WHERE deleted_at IS NULL AND subscription_type IS NOT NULL;
