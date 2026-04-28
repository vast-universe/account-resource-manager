-- 添加支付注册所需的字段
ALTER TABLE chatgpt_accounts
ADD COLUMN IF NOT EXISTS password TEXT,
ADD COLUMN IF NOT EXISTS access_token TEXT,
ADD COLUMN IF NOT EXISTS refresh_token TEXT,
ADD COLUMN IF NOT EXISTS id_token TEXT,
ADD COLUMN IF NOT EXISTS session_token TEXT,
ADD COLUMN IF NOT EXISTS account_id TEXT,
ADD COLUMN IF NOT EXISTS checkout_url TEXT,
ADD COLUMN IF NOT EXISTS team_checkout_url TEXT,
ADD COLUMN IF NOT EXISTS email_service_id VARCHAR(255);

-- 更新 registration_source 约束，添加 payment_register
ALTER TABLE chatgpt_accounts
DROP CONSTRAINT IF EXISTS chatgpt_accounts_registration_source_check;

ALTER TABLE chatgpt_accounts
ADD CONSTRAINT chatgpt_accounts_registration_source_check
CHECK (registration_source = ANY (ARRAY[
    'manual'::text,
    'batch_register'::text,
    'batch_login'::text,
    'import'::text,
    'payment_register'::text
]));

-- 添加注释
COMMENT ON COLUMN chatgpt_accounts.password IS '账号明文密码';
COMMENT ON COLUMN chatgpt_accounts.access_token IS 'Access Token';
COMMENT ON COLUMN chatgpt_accounts.refresh_token IS 'Refresh Token';
COMMENT ON COLUMN chatgpt_accounts.id_token IS 'ID Token';
COMMENT ON COLUMN chatgpt_accounts.session_token IS 'Session Token';
COMMENT ON COLUMN chatgpt_accounts.account_id IS 'ChatGPT Account ID';
COMMENT ON COLUMN chatgpt_accounts.checkout_url IS 'Plus 支付链接';
COMMENT ON COLUMN chatgpt_accounts.team_checkout_url IS 'Team 支付链接';
COMMENT ON COLUMN chatgpt_accounts.email_service_id IS 'MoeMail 邮箱 ID';
