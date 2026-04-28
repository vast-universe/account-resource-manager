-- ChatGPT 账号管理表
-- 依赖: pgcrypto 扩展 (已在 mailbox_v1.sql 中创建)

create table if not exists chatgpt_accounts (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,

  email text not null unique,
  email_normalized text not null,

  -- 关联邮箱资源 (如果通过系统邮箱注册)
  mailbox_id bigint references mailboxes(id) on delete set null,

  -- 账号状态
  status text not null default 'pending'
    check (status in ('pending', 'active', 'suspended', 'failed', 'expired')),

  -- OAuth 相关
  oauth_account_id text,
  oauth_issuer text,

  -- 账号健康状态
  health_status text not null default 'unknown'
    check (health_status in ('unknown', 'healthy', 'warning', 'invalid')),

  -- 最后检查信息
  last_checked_at timestamptz,
  last_check_result text,

  -- Token 过期时间
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,

  -- 注册来源
  registration_source text not null default 'manual'
    check (registration_source in ('manual', 'batch_register', 'batch_login', 'import')),

  -- 元数据
  metadata jsonb default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,

  constraint uq_chatgpt_accounts_email_normalized unique (email_normalized)
);

-- 凭证表 (敏感信息加密存储)
create table if not exists chatgpt_account_credentials (
  account_id bigint primary key references chatgpt_accounts(id) on delete cascade,

  password_ciphertext text not null,

  -- OAuth tokens
  access_token_ciphertext text,
  refresh_token_ciphertext text,
  id_token_ciphertext text,

  -- Session token (如果是 session 模式)
  session_token_ciphertext text,

  -- 加密版本 (用于密钥轮换)
  secret_version integer not null default 1,

  updated_at timestamptz not null default now()
);

-- 登录/检查历史
create table if not exists chatgpt_account_check_runs (
  id bigint generated always as identity primary key,
  account_id bigint not null references chatgpt_accounts(id) on delete cascade,

  trigger_source text not null default 'manual'
    check (trigger_source in ('manual', 'scheduled', 'batch_login', 'health_check')),

  status text not null
    check (status in ('pending', 'running', 'success', 'failed')),

  -- 检查后的状态
  health_status_after text
    check (health_status_after in ('unknown', 'healthy', 'warning', 'invalid')),

  -- Token 刷新结果
  token_refreshed boolean default false,

  checked_at timestamptz,
  error_message text,

  -- 详细日志
  logs jsonb default '[]'::jsonb,

  created_at timestamptz not null default now()
);

-- 账号使用记录 (可选，用于追踪账号使用情况)
create table if not exists chatgpt_account_usage_logs (
  id bigint generated always as identity primary key,
  account_id bigint not null references chatgpt_accounts(id) on delete cascade,

  action text not null
    check (action in ('login', 'token_refresh', 'api_call', 'checkout', 'subscription')),

  success boolean not null,
  error_message text,

  -- 使用详情
  details jsonb default '{}'::jsonb,

  created_at timestamptz not null default now()
);

-- 索引
create index if not exists idx_chatgpt_accounts_status_updated
  on chatgpt_accounts (status, updated_at desc)
  where deleted_at is null;

create index if not exists idx_chatgpt_accounts_health_status
  on chatgpt_accounts (health_status, updated_at desc)
  where deleted_at is null;

create index if not exists idx_chatgpt_accounts_mailbox
  on chatgpt_accounts (mailbox_id)
  where deleted_at is null and mailbox_id is not null;

create index if not exists idx_chatgpt_accounts_email_normalized
  on chatgpt_accounts (email_normalized)
  where deleted_at is null;

create index if not exists idx_chatgpt_accounts_oauth_account
  on chatgpt_accounts (oauth_account_id)
  where deleted_at is null and oauth_account_id is not null;

create index if not exists idx_chatgpt_accounts_created
  on chatgpt_accounts (created_at desc)
  where deleted_at is null;

create index if not exists idx_chatgpt_account_check_runs_account_created
  on chatgpt_account_check_runs (account_id, created_at desc);

create index if not exists idx_chatgpt_account_usage_logs_account_created
  on chatgpt_account_usage_logs (account_id, created_at desc);

-- 触发器：自动更新 updated_at
create or replace function update_chatgpt_account_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trigger_chatgpt_accounts_updated_at
  before update on chatgpt_accounts
  for each row
  execute function update_chatgpt_account_updated_at();

create trigger trigger_chatgpt_account_credentials_updated_at
  before update on chatgpt_account_credentials
  for each row
  execute function update_chatgpt_account_updated_at();

-- 视图：账号概览 (不包含敏感信息)
create or replace view chatgpt_accounts_overview as
select
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
  m.email as mailbox_email,
  (select count(*) from chatgpt_account_check_runs where account_id = a.id) as check_run_count,
  (select count(*) from chatgpt_account_usage_logs where account_id = a.id) as usage_log_count
from chatgpt_accounts a
left join mailboxes m on a.mailbox_id = m.id
where a.deleted_at is null;
