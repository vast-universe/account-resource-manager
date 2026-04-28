-- 添加明文密码字段到 chatgpt_accounts 表
-- password_hash 历史上实际存的是明文密码，新增 password 作为语义清晰的字段。

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
  END IF;
END $$;

COMMENT ON COLUMN chatgpt_accounts.password IS '账号明文密码';
