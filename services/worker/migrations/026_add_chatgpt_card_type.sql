-- 添加 ChatGPT 账号绑卡类型，现有账号默认短效
ALTER TABLE chatgpt_accounts
ADD COLUMN IF NOT EXISTS card_type TEXT NOT NULL DEFAULT '短效';

UPDATE chatgpt_accounts
SET card_type = '短效'
WHERE card_type IS NULL OR card_type NOT IN ('短效', '长效');

ALTER TABLE chatgpt_accounts
ALTER COLUMN card_type SET DEFAULT '短效',
ALTER COLUMN card_type SET NOT NULL;

ALTER TABLE chatgpt_accounts
DROP CONSTRAINT IF EXISTS chatgpt_accounts_card_type_check;

ALTER TABLE chatgpt_accounts
ADD CONSTRAINT chatgpt_accounts_card_type_check
CHECK (card_type IN ('短效', '长效'));

COMMENT ON COLUMN chatgpt_accounts.card_type IS '绑卡类型: 短效 / 长效';

CREATE INDEX IF NOT EXISTS idx_chatgpt_accounts_card_type
ON chatgpt_accounts(card_type)
WHERE deleted_at IS NULL;
