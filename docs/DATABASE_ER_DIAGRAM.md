# 数据库 ER 图

## 支付注册相关表关系

```
┌─────────────────────────────────────────────────────────────────────┐
│                        registration_tasks                            │
│─────────────────────────────────────────────────────────────────────│
│ PK  id                SERIAL                                         │
│ UK  task_id           VARCHAR(255)    任务唯一标识 (UUID)            │
│     task_type         VARCHAR(50)     'payment_registration'         │
│     status            VARCHAR(50)     pending/running/completed/failed│
│     result            TEXT            成功时的邮箱地址                │
│     error_message     TEXT            失败时的错误信息                │
│     created_at        TIMESTAMP                                      │
│     started_at        TIMESTAMP                                      │
│     completed_at      TIMESTAMP                                      │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ 1:1 (通过 task_id = public_id)
                                    ↓
┌─────────────────────────────────────────────────────────────────────┐
│                        chatgpt_accounts                              │
│─────────────────────────────────────────────────────────────────────│
│ PK  id                BIGINT                                         │
│ UK  public_id         UUID            任务 ID / 账号公开 ID          │
│ UK  email             TEXT            邮箱地址                       │
│     email_normalized  TEXT            标准化邮箱                     │
│ FK  mailbox_id        BIGINT          → mailboxes.id (可选)         │
│     status            TEXT            active/failed/suspended/...    │
│     auth_mode         TEXT            session/oauth                  │
│     oauth_account_id  TEXT                                           │
│     oauth_issuer      TEXT                                           │
│     health_status     TEXT            unknown/healthy/warning/invalid│
│     last_checked_at   TIMESTAMPTZ                                    │
│     last_check_result TEXT                                           │
│     access_token_expires_at  TIMESTAMPTZ                             │
│     refresh_token_expires_at TIMESTAMPTZ                             │
│     registration_source TEXT          'payment_register'             │
│     ┌──────────────────────────────────────────────────────────┐    │
│     │ 支付注册新增字段                                          │    │
│     │ checkout_url        TEXT    Plus 支付链接                │    │
│     │ team_checkout_url   TEXT    Team 支付链接                │    │
│     │ email_service_id    VARCHAR MoeMail email_id             │    │
│     └──────────────────────────────────────────────────────────┘    │
│     metadata          JSONB           扩展元数据                     │
│     created_at        TIMESTAMPTZ                                    │
│     updated_at        TIMESTAMPTZ                                    │
│     deleted_at        TIMESTAMPTZ     软删除                         │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ 1:1
                                    ↓
┌─────────────────────────────────────────────────────────────────────┐
│                   chatgpt_account_credentials                        │
│─────────────────────────────────────────────────────────────────────│
│ PK  account_id              BIGINT  → chatgpt_accounts.id           │
│     password_ciphertext     TEXT    加密的密码                       │
│     access_token_ciphertext TEXT    加密的访问令牌                   │
│     refresh_token_ciphertext TEXT   加密的刷新令牌                   │
│     id_token_ciphertext     TEXT    加密的 ID 令牌                   │
│     session_token_ciphertext TEXT   加密的会话令牌                   │
│     secret_version          INTEGER 加密版本                         │
│     updated_at              TIMESTAMPTZ                              │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                        email_providers                               │
│─────────────────────────────────────────────────────────────────────│
│ PK  id                BIGINT                                         │
│     public_id         UUID                                           │
│     provider_type     TEXT            moemail/duckmail/...           │
│     name              TEXT            提供商名称                     │
│     description       TEXT                                           │
│     api_url           TEXT            API 地址                       │
│     api_key_ciphertext TEXT           加密的 API Key                 │
│     config            JSONB           配置信息                       │
│     status            TEXT            active/inactive/error          │
│     is_default        BOOLEAN         是否默认                       │
│     health_check_status TEXT          healthy/degraded/down          │
│     created_at        TIMESTAMPTZ                                    │
│     updated_at        TIMESTAMPTZ                                    │
│     deleted_at        TIMESTAMPTZ                                    │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ 使用 (通过 email_service_id)
                                    ↓
                        (chatgpt_accounts.email_service_id)
```

## 数据流转图

```
┌──────────────┐
│   用户请求    │
│ 支付注册      │
└──────┬───────┘
       │
       ↓
┌──────────────────────────────────────────────────────────┐
│ 1. 创建任务                                               │
│    INSERT INTO registration_tasks                         │
│    (task_id, task_type='payment_registration',           │
│     status='pending')                                     │
└──────┬───────────────────────────────────────────────────┘
       │
       ↓
┌──────────────────────────────────────────────────────────┐
│ 2. 开始执行                                               │
│    UPDATE registration_tasks                              │
│    SET status='running', started_at=NOW()                 │
└──────┬───────────────────────────────────────────────────┘
       │
       ↓
┌──────────────────────────────────────────────────────────┐
│ 3. 获取邮箱提供商                                         │
│    SELECT * FROM email_providers                          │
│    WHERE status='active' AND is_default=true              │
│                                                            │
│    解密 API Key:                                          │
│    decrypt(api_key_ciphertext) → api_key                  │
└──────┬───────────────────────────────────────────────────┘
       │
       ↓
┌──────────────────────────────────────────────────────────┐
│ 4. 调用 MoeMail API 创建邮箱                             │
│    POST /api/emails/generate                              │
│    → 返回: email, email_id                                │
└──────┬───────────────────────────────────────────────────┘
       │
       ↓
┌──────────────────────────────────────────────────────────┐
│ 5. 执行 ChatGPT 注册流程                                 │
│    - 访问首页                                             │
│    - 获取 CSRF token                                      │
│    - 提交邮箱                                             │
│    - 授权                                                 │
│    - 注册用户                                             │
│    - 发送验证码                                           │
└──────┬───────────────────────────────────────────────────┘
       │
       ↓
┌──────────────────────────────────────────────────────────┐
│ 6. 查询验证码                                             │
│    GET /api/emails/{email_id}                             │
│    → 提取 6 位数字验证码                                  │
└──────┬───────────────────────────────────────────────────┘
       │
       ↓
┌──────────────────────────────────────────────────────────┐
│ 7. 完成注册                                               │
│    - 验证验证码                                           │
│    - 创建账号（填写姓名生日）                             │
│    - 获取 session token                                   │
│    - 获取用户国家信息                                     │
│    - 创建支付会话（Plus + Team）                         │
└──────┬───────────────────────────────────────────────────┘
       │
       ↓
┌──────────────────────────────────────────────────────────┐
│ 8. 保存账号信息                                           │
│    INSERT INTO chatgpt_accounts                           │
│    (public_id=task_id, email, status='active',           │
│     registration_source='payment_register',               │
│     checkout_url, team_checkout_url,                      │
│     email_service_id)                                     │
│                                                            │
│    INSERT INTO chatgpt_account_credentials                │
│    (account_id, password_ciphertext,                      │
│     access_token_ciphertext,                              │
│     session_token_ciphertext)                             │
└──────┬───────────────────────────────────────────────────┘
       │
       ↓
┌──────────────────────────────────────────────────────────┐
│ 9. 更新任务状态                                           │
│    UPDATE registration_tasks                              │
│    SET status='completed',                                │
│        result=email,                                      │
│        completed_at=NOW()                                 │
└──────┬───────────────────────────────────────────────────┘
       │
       ↓
┌──────────────┐
│   完成       │
└──────────────┘
```

## 字段映射关系

### PaymentRegistrationResult → Database

```
PaymentRegistrationResult (Python)          Database Tables
─────────────────────────────────────────────────────────────────
success: bool                               → registration_tasks.status
email: str                                  → chatgpt_accounts.email
                                            → registration_tasks.result
password: str                               → chatgpt_account_credentials.password_ciphertext
access_token: str                           → chatgpt_account_credentials.access_token_ciphertext
refresh_token: str                          → chatgpt_account_credentials.refresh_token_ciphertext
id_token: str                               → chatgpt_account_credentials.id_token_ciphertext
session_token: str                          → chatgpt_account_credentials.session_token_ciphertext
account_id: str                             → chatgpt_accounts.oauth_account_id (?)
checkout_url: str                           → chatgpt_accounts.checkout_url
team_checkout_url: str                      → chatgpt_accounts.team_checkout_url
email_service_id: str                       → chatgpt_accounts.email_service_id
error_message: str                          → registration_tasks.error_message
source: str                                 → chatgpt_accounts.registration_source
```

## 索引策略

### registration_tasks
```sql
CREATE INDEX idx_registration_tasks_task_id ON registration_tasks(task_id);
CREATE INDEX idx_registration_tasks_status ON registration_tasks(status);
CREATE INDEX idx_registration_tasks_created_at ON registration_tasks(created_at DESC);
```

**用途**:
- `task_id`: 快速查询任务状态
- `status`: 筛选特定状态的任务
- `created_at`: 按时间排序查询

### chatgpt_accounts
```sql
CREATE UNIQUE INDEX uq_chatgpt_accounts_email_normalized 
    ON chatgpt_accounts(email_normalized);
CREATE INDEX idx_chatgpt_accounts_registration_source 
    ON chatgpt_accounts(registration_source) 
    WHERE deleted_at IS NULL;
CREATE INDEX idx_chatgpt_accounts_status 
    ON chatgpt_accounts(status, updated_at DESC) 
    WHERE deleted_at IS NULL;
```

**用途**:
- `email_normalized`: 防止重复邮箱
- `registration_source`: 筛选支付注册的账号
- `status`: 按状态查询账号

## 数据保留策略

### 建议的数据清理策略

```sql
-- 清理 30 天前失败的任务
DELETE FROM registration_tasks
WHERE status = 'failed'
  AND completed_at < NOW() - INTERVAL '30 days';

-- 软删除 90 天未使用的账号
UPDATE chatgpt_accounts
SET deleted_at = NOW()
WHERE last_checked_at < NOW() - INTERVAL '90 days'
  AND status = 'active'
  AND deleted_at IS NULL;

-- 清理已软删除 30 天的账号凭证
DELETE FROM chatgpt_account_credentials
WHERE account_id IN (
    SELECT id FROM chatgpt_accounts
    WHERE deleted_at < NOW() - INTERVAL '30 days'
);
```

## 相关文档

- [完整数据库表设计](./DATABASE_SCHEMA.md)
- [数据库初始化脚本](../docs/sql/00_init.sql)
- [Worker 迁移脚本](../services/worker/migrations/001_create_tables.sql)
