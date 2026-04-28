-- Add payment_status field to chatgpt_accounts table
ALTER TABLE chatgpt_accounts
ADD COLUMN IF NOT EXISTS payment_status VARCHAR(50) DEFAULT 'pending';

-- Add index for payment_status
CREATE INDEX IF NOT EXISTS idx_chatgpt_accounts_payment_status ON chatgpt_accounts(payment_status);
