# 支付注册数据库表设计

## 概述

支付注册功能涉及 3 个主要数据表和 1 个凭证表，用于存储注册任务、账号信息和敏感凭证。

## 数据表结构

### 1. registration_tasks (注册任务表)

**用途**: 跟踪每个支付注册任务的状态和结果

**表结构**:
```sql
CREATE TABLE registration_tasks (
    id SERIAL PRIMARY KEY,
    task_id VARCHAR(255) UNIQUE NOT NULL,      -- UUID，任务唯一标识
    task_type VARCHAR(50) NOT NULL,            -- 任务类型: 'payment_registration'
    status VARCHAR(50) NOT NULL DEFAULT 'pending',  -- 状态: pending/running/completed/failed
    result TEXT,                                -- 成功时的结果（邮箱地址）
    error_message TEXT,                         -- 失败时的错误信息
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    started_at TIMESTAMP,                       -- 任务开始时间
    completed_at TIMESTAMP                      -- 任务完成时间
);
```

**索引**:
- `idx_registration_tasks_task_id` - 任务 ID 索引
- `idx_registration_tasks_status` - 状态索引
- `idx_registration_tasks_created_at` - 创建时间索引（降序）

**存储的数据**:
| 字段 | 说明 | 示例值 |
|------|------|--------|
| task_id | 任务唯一标识 | `550e8400-e29b-41d4-a716-446655440000` |
| task_type | 任务类型 | `payment_registration` |
| status | 任务状态 | `pending` → `running` → `completed` |
| result | 注册成功的邮箱 | `user@example.com` |
| error_message | 错误信息 | `创建邮箱失败` / `未收到验证码` |
| created_at | 创建时间 | `2024-04-25 10:00:00` |
| started_at | 开始时间 | `2024-04-25 10:00:01` |
| completed_at | 完成时间 | `2024-04-25 10:02:30` |

**生命周期**:
```
创建任务 → pending
开始执行 → running
完成/失败 → completed/failed
```

---

### 2. chatgpt_accounts (ChatGPT 账号表)

**用途**: 存储 ChatGPT 账号的基本信息和状态

**表结构**:
```sql
CREATE TABLE chatgpt_accounts (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    public_id UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    
    -- 邮箱信息
    email TEXT NOT NULL UNIQUE,
    email_normalized TEXT NOT NULL,
    mailbox_id BIGINT REFERENCES mailboxes(id) ON DELETE SET NULL,
    
    -- 账号状态
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'active', 'suspended', 'failed', 'expired')),
    
    auth_mode TEXT NOT NULL DEFAULT 'session'
        CHECK (auth_mode IN ('session', 'oauth')),
    
    oauth_account_id TEXT,
    oauth_issuer TEXT,
    
    -- 健康状态
    health_status TEXT NOT NULL DEFAULT 'unknown'
        CHECK (health_status IN ('unknown', 'healthy', 'warning', 'invalid')),
    
    last_checked_at TIMESTAMPTZ,
    last_check_result TEXT,
    
    -- Token 过期时间
    access_token_expires_at TIMESTAMPTZ,
    refresh_token_expires_at TIMESTAMPTZ,
    
    -- 注册来源
    registration_source TEXT NOT NULL DEFAULT 'manual'
        CHECK (registration_source IN ('manual', 'batch_register', 'batch_login', 'import', 'payment_register')),
    
    -- 支付注册新增字段
    checkout_url TEXT,              -- Plus 支付链接
    team_checkout_url TEXT,         -- Team 支付链接
    email_service_id VARCHAR(255),  -- 邮箱服务 ID (MoeMail email_id)
    
    -- 元数据
    metadata JSONB DEFAULT '{}'::JSONB,
    
    -- 时间戳
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);
```

**支付注册存储的数据**:
| 字段 | 说明 | 示例值 |
|------|------|--------|
| public_id | 公开 UUID | `550e8400-e29b-41d4-a716-446655440000` |
| email | 邮箱地址 | `user@example.com` |
| email_normalized | 标准化邮箱 | `user@example.com` |
| status | 账号状态 | `active` (成功) / `failed` (失败) |
| auth_mode | 认证模式 | `session` |
| health_status | 健康状态 | `unknown` (初始状态) |
| registration_source | 注册来源 | `payment_register` |
| **checkout_url** | **Plus 支付链接** | `https://chatgpt.com/checkout/openai_llc/cs_xxx` |
| **team_checkout_url** | **Team 支付链接** | `https://chatgpt.com/checkout/openai_llc/cs_yyy` |
| **email_service_id** | **邮箱服务 ID** | `email_abc123` (MoeMail 的 email_id) |
| created_at | 创建时间 | `2024-04-25 10:02:30` |
| updated_at | 更新时间 | `2024-04-25 10:02:30` |

---

### 3. chatgpt_account_credentials (账号凭证表)

**用途**: 存储加密的敏感凭证信息

**表结构**:
```sql
CREATE TABLE chatgpt_account_credentials (
    account_id BIGINT PRIMARY KEY REFERENCES chatgpt_accounts(id) ON DELETE CASCADE,
    
    -- 加密的凭证
    password_ciphertext TEXT NOT NULL,
    access_token_ciphertext TEXT,
    refresh_token_ciphertext TEXT,
    id_token_ciphertext TEXT,
    session_token_ciphertext TEXT,
    
    -- 加密版本
    secret_version INTEGER NOT NULL DEFAULT 1,
    
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**支付注册存储的数据** (加密后):
| 字段 | 说明 | 原始数据示例 | 加密格式 |
|------|------|-------------|---------|
| password_ciphertext | 加密的密码 | `MyP@ssw0rd123` | `v1.{iv}.{tag}.{ciphertext}` |
| access_token_ciphertext | 加密的访问令牌 | `eyJhbGc...` | `v1.{iv}.{tag}.{ciphertext}` |
| refresh_token_ciphertext | 加密的刷新令牌 | `ey-refresh...` | `v1.{iv}.{tag}.{ciphertext}` |
| id_token_ciphertext | 加密的 ID 令牌 | `eyJhbGc...` | `v1.{iv}.{tag}.{ciphertext}` |
| session_token_ciphertext | 加密的会话令牌 | `ey-session...` | `v1.{iv}.{tag}.{ciphertext}` |

**加密格式**: AES-256-GCM
```
v1.{iv_base64url}.{auth_tag_base64url}.{ciphertext_base64url}
```

---

### 4. email_messages (邮件消息表)

**用途**: 存储邮件消息（可选，当前未使用）

**表结构**:
```sql
CREATE TABLE email_messages (
    id SERIAL PRIMARY KEY,
    recipient VARCHAR(255) NOT NULL,
    sender VARCHAR(255),
    subject TEXT,
    body_text TEXT,
    body_html TEXT,
    received_at TIMESTAMP NOT NULL DEFAULT NOW(),
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

**说明**: 当前支付注册直接通过 MoeMail API 查询邮件，不存储到此表。

---

## 数据流程

### 1. 创建任务

```sql
INSERT INTO registration_tasks (task_id, task_type, status, created_at)
VALUES ('uuid-xxx', 'payment_registration', 'pending', NOW());
```

### 2. 开始执行

```sql
UPDATE registration_tasks
SET status = 'running', started_at = NOW()
WHERE task_id = 'uuid-xxx';
```

### 3. 注册成功 - 保存账号

```sql
-- 插入账号基本信息
INSERT INTO chatgpt_accounts (
    public_id, email, email_normalized, status, auth_mode,
    health_status, registration_source, checkout_url, team_checkout_url,
    email_service_id, created_at, updated_at
) VALUES (
    'uuid-xxx',
    'user@example.com',
    'user@example.com',
    'active',
    'session',
    'unknown',
    'payment_register',
    'https://chatgpt.com/checkout/openai_llc/cs_plus_xxx',
    'https://chatgpt.com/checkout/openai_llc/cs_team_xxx',
    'email_abc123',
    NOW(),
    NOW()
) RETURNING id;

-- 插入加密的凭证
INSERT INTO chatgpt_account_credentials (
    account_id,
    password_ciphertext,
    access_token_ciphertext,
    session_token_ciphertext,
    secret_version,
    updated_at
) VALUES (
    {account_id},
    'v1.{encrypted_password}',
    'v1.{encrypted_access_token}',
    'v1.{encrypted_session_token}',
    1,
    NOW()
);
```

### 4. 更新任务状态

```sql
-- 成功
UPDATE registration_tasks
SET status = 'completed', completed_at = NOW(), result = 'user@example.com'
WHERE task_id = 'uuid-xxx';

-- 失败
UPDATE registration_tasks
SET status = 'failed', completed_at = NOW(), error_message = '未收到验证码'
WHERE task_id = 'uuid-xxx';
```

---

## 数据示例

### 完整的注册流程数据

**1. registration_tasks 表**:
```
id: 1
task_id: 550e8400-e29b-41d4-a716-446655440000
task_type: payment_registration
status: completed
result: user@example.com
error_message: NULL
created_at: 2024-04-25 10:00:00
started_at: 2024-04-25 10:00:01
completed_at: 2024-04-25 10:02:30
```

**2. chatgpt_accounts 表**:
```
id: 1
public_id: 550e8400-e29b-41d4-a716-446655440000
email: user@example.com
email_normalized: user@example.com
mailbox_id: NULL
status: active
auth_mode: session
oauth_account_id: NULL
oauth_issuer: NULL
health_status: unknown
last_checked_at: NULL
last_check_result: NULL
access_token_expires_at: NULL
refresh_token_expires_at: NULL
registration_source: payment_register
checkout_url: https://chatgpt.com/checkout/openai_llc/cs_live_xxx
team_checkout_url: https://chatgpt.com/checkout/openai_llc/cs_live_yyy
email_service_id: email_abc123
metadata: {}
created_at: 2024-04-25 10:02:30
updated_at: 2024-04-25 10:02:30
deleted_at: NULL
```

**3. chatgpt_account_credentials 表**:
```
account_id: 1
password_ciphertext: v1.dGVzdA.dGVzdA.cGFzc3dvcmQ
access_token_ciphertext: v1.dGVzdA.dGVzdA.YWNjZXNz
refresh_token_ciphertext: NULL
id_token_ciphertext: NULL
session_token_ciphertext: v1.dGVzdA.dGVzdA.c2Vzc2lvbg
secret_version: 1
updated_at: 2024-04-25 10:02:30
```

---

## 查询示例

### 查看最近的注册任务

```sql
SELECT 
    task_id,
    task_type,
    status,
    result,
    error_message,
    created_at,
    completed_at,
    EXTRACT(EPOCH FROM (completed_at - started_at)) as duration_seconds
FROM registration_tasks
ORDER BY created_at DESC
LIMIT 10;
```

### 查看支付注册的账号

```sql
SELECT 
    a.email,
    a.status,
    a.health_status,
    a.checkout_url,
    a.team_checkout_url,
    a.email_service_id,
    a.created_at
FROM chatgpt_accounts a
WHERE a.registration_source = 'payment_register'
    AND a.deleted_at IS NULL
ORDER BY a.created_at DESC;
```

### 查看账号的完整信息（包含凭证）

```sql
SELECT 
    a.email,
    a.status,
    a.checkout_url,
    c.password_ciphertext,
    c.access_token_ciphertext,
    c.session_token_ciphertext
FROM chatgpt_accounts a
LEFT JOIN chatgpt_account_credentials c ON a.id = c.account_id
WHERE a.email = 'user@example.com';
```

### 统计注册成功率

```sql
SELECT 
    COUNT(*) as total_tasks,
    SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
    SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
    ROUND(100.0 * SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) / COUNT(*), 2) as success_rate
FROM registration_tasks
WHERE task_type = 'payment_registration'
    AND created_at >= NOW() - INTERVAL '7 days';
```

---

## 数据安全

### 1. 敏感数据加密

所有敏感凭证使用 AES-256-GCM 加密：
- 密码
- Access Token
- Refresh Token
- ID Token
- Session Token

### 2. 加密密钥管理

密钥来源（优先级）:
1. `ARM_DATA_ENCRYPTION_KEY` 环境变量
2. `ARM_SESSION_SECRET` 环境变量
3. 默认值（仅开发环境）

### 3. 数据访问控制

- 凭证表通过外键级联删除
- 软删除支持（deleted_at 字段）
- 索引优化查询性能

---

## 注意事项

### ⚠️ 当前问题

1. **密码未加密**: 
   ```python
   result.password,  # 实际应该加密
   ```
   代码中标注了但未实现，密码应该存储到 `chatgpt_account_credentials.password_ciphertext`

2. **缺少 account_id 字段**:
   当前直接存储到 `chatgpt_accounts` 表，但应该关联到 `chatgpt_account_credentials`

### 🔧 建议改进

1. **实现密码加密**:
   ```python
   from utils.crypto import encrypt_secret
   
   password_encrypted = encrypt_secret(result.password)
   ```

2. **分离凭证存储**:
   - 基本信息 → `chatgpt_accounts`
   - 敏感凭证 → `chatgpt_account_credentials`

3. **添加更多元数据**:
   ```json
   {
     "country": "US",
     "currency": "USD",
     "registration_ip": "1.2.3.4",
     "user_agent": "...",
     "registration_duration": 120
   }
   ```

4. **添加审计日志**:
   记录账号的所有操作历史

---

## 相关文档

- [数据库初始化脚本](../docs/sql/00_init.sql)
- [Worker 迁移脚本](../services/worker/migrations/001_create_tables.sql)
- [加密工具](../services/worker/utils/crypto.py)
- [MoeMail 集成](./MOEMAIL_INTEGRATION.md)
