-- 添加导出/推送标记字段
ALTER TABLE chatgpt_accounts
ADD COLUMN IF NOT EXISTS exported BOOLEAN NOT NULL DEFAULT FALSE;

-- 添加导出时间字段
ALTER TABLE chatgpt_accounts
ADD COLUMN IF NOT EXISTS exported_at TIMESTAMPTZ;

-- 添加索引以便快速查询未导出的账号
CREATE INDEX IF NOT EXISTS idx_chatgpt_accounts_exported
ON chatgpt_accounts(exported) WHERE deleted_at IS NULL;
