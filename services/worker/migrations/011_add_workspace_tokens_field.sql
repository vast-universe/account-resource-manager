-- 添加 workspace_tokens 字段用于存储多个 workspace 的 token 信息
-- 格式: JSON array of {workspace_id, workspace_name, access_token, refresh_token, expires_at}

ALTER TABLE chatgpt_accounts
ADD COLUMN IF NOT EXISTS workspace_tokens JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN chatgpt_accounts.workspace_tokens IS '所有 workspace 的 token 信息 (JSON array)';
