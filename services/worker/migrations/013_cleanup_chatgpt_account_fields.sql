-- 清理 ChatGPT 账号表中的历史兼容字段。
-- 当前约定:
--   - chatgpt_accounts.password 存储账号明文密码
--   - chatgpt_accounts.email_service_id 存储 MoeMail 邮箱 ID

ALTER TABLE chatgpt_accounts
ADD COLUMN IF NOT EXISTS password TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'chatgpt_accounts'
      AND column_name = 'password_hash'
  ) THEN
    UPDATE chatgpt_accounts
    SET password = password_hash
    WHERE password IS NULL
      AND password_hash IS NOT NULL;

    ALTER TABLE chatgpt_accounts
    DROP COLUMN password_hash;
  END IF;
END $$;

COMMENT ON COLUMN chatgpt_accounts.password IS '账号明文密码';
COMMENT ON COLUMN chatgpt_accounts.email_service_id IS 'MoeMail 邮箱 ID';
