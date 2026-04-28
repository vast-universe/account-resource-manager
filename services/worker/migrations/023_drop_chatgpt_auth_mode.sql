-- ChatGPT 账号不再存储认证方式
DROP VIEW IF EXISTS chatgpt_accounts_overview;

ALTER TABLE chatgpt_accounts
DROP COLUMN IF EXISTS auth_mode;

CREATE OR REPLACE VIEW chatgpt_accounts_overview AS
SELECT
  a.id,
  a.public_id,
  a.email,
  a.status,
  a.health_status,
  a.oauth_account_id,
  a.last_checked_at,
  a.last_check_result,
  a.access_token_expires_at,
  a.refresh_token_expires_at,
  a.registration_source,
  a.created_at,
  a.updated_at,
  NULL::text AS mailbox_email,
  (SELECT COUNT(*) FROM chatgpt_account_check_runs WHERE account_id = a.id) AS check_run_count,
  (SELECT COUNT(*) FROM chatgpt_account_usage_logs WHERE account_id = a.id) AS usage_log_count
FROM chatgpt_accounts a
WHERE a.deleted_at IS NULL;
