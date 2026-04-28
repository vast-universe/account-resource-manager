-- Drop only the local mailbox/resource storage tables.
--
-- MoeMail inbox browsing is API-backed and remains available through /resources/moemail.
-- Core data in chatgpt_accounts, registration_tasks, email_providers, proxies, etc. is preserved.

DROP VIEW IF EXISTS chatgpt_accounts_overview CASCADE;

ALTER TABLE chatgpt_accounts
DROP CONSTRAINT IF EXISTS chatgpt_accounts_mailbox_id_fkey;

DROP INDEX IF EXISTS idx_chatgpt_accounts_mailbox;

DROP TABLE IF EXISTS mailbox_messages CASCADE;
DROP TABLE IF EXISTS mailbox_check_runs CASCADE;
DROP TABLE IF EXISTS mailbox_credentials CASCADE;
DROP TABLE IF EXISTS mailboxes CASCADE;
DROP TABLE IF EXISTS moemail_mailboxes CASCADE;
DROP TABLE IF EXISTS email_messages CASCADE;
