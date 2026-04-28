-- 创建注册任务表
CREATE TABLE IF NOT EXISTS registration_tasks (
    id SERIAL PRIMARY KEY,
    task_id VARCHAR(255) UNIQUE NOT NULL,
    task_type VARCHAR(50) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    result TEXT,
    error_message TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    started_at TIMESTAMP,
    completed_at TIMESTAMP
);

CREATE INDEX idx_registration_tasks_task_id ON registration_tasks(task_id);
CREATE INDEX idx_registration_tasks_status ON registration_tasks(status);
CREATE INDEX idx_registration_tasks_created_at ON registration_tasks(created_at DESC);

-- 创建邮件消息表（如果不存在）
CREATE TABLE IF NOT EXISTS email_messages (
    id SERIAL PRIMARY KEY,
    recipient VARCHAR(255) NOT NULL,
    sender VARCHAR(255),
    subject TEXT,
    body_text TEXT,
    body_html TEXT,
    received_at TIMESTAMP NOT NULL DEFAULT NOW(),
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_email_messages_recipient ON email_messages(recipient);
CREATE INDEX idx_email_messages_received_at ON email_messages(received_at DESC);

-- 更新 chatgpt_accounts 表（如果需要添加新字段）
ALTER TABLE chatgpt_accounts
ADD COLUMN IF NOT EXISTS checkout_url TEXT,
ADD COLUMN IF NOT EXISTS team_checkout_url TEXT,
ADD COLUMN IF NOT EXISTS email_service_id VARCHAR(255);

COMMENT ON TABLE registration_tasks IS '注册任务表';
COMMENT ON TABLE email_messages IS '邮件消息表';
COMMENT ON COLUMN chatgpt_accounts.checkout_url IS 'Plus 支付链接';
COMMENT ON COLUMN chatgpt_accounts.team_checkout_url IS 'Team 支付链接';
COMMENT ON COLUMN chatgpt_accounts.email_service_id IS 'MoeMail 邮箱 ID';
