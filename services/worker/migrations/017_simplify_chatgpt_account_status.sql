-- 账号状态只保留 active / abnormal。

UPDATE chatgpt_accounts
SET status = CASE WHEN status = 'active' THEN 'active' ELSE 'abnormal' END
WHERE status IS DISTINCT FROM CASE WHEN status = 'active' THEN 'active' ELSE 'abnormal' END;

ALTER TABLE chatgpt_accounts
ALTER COLUMN status SET DEFAULT 'active';

ALTER TABLE chatgpt_accounts
DROP CONSTRAINT IF EXISTS chatgpt_accounts_status_check;

ALTER TABLE chatgpt_accounts
ADD CONSTRAINT chatgpt_accounts_status_check
CHECK (status IN ('active', 'abnormal'));
