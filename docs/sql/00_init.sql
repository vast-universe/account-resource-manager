-- 初始化脚本 - 按正确顺序执行所有迁移

-- 1. 创建扩展
create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

-- 2. 邮箱资源表 (mailbox_v1.sql)
create table if not exists mailboxes (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,

  email text not null,
  email_normalized text not null,
  email_domain text not null,

  profile_id text not null,

  auth_mode text not null default 'session'
    check (auth_mode in ('session', 'oauth')),

  health_status text not null default 'unknown'
    check (health_status in ('unknown', 'healthy', 'warning', 'invalid')),

  auth_status text not null default 'unknown'
    check (auth_status in ('unknown', 'valid', 'expiring', 'needs_refresh', 'reauth_required')),

  last_checked_at timestamptz,
  last_check_result text,
  last_auth_refresh_at timestamptz,
  auth_expires_at timestamptz,

  message_count integer not null default 0,
  unread_count integer not null default 0,
  latest_message_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,

  constraint uq_mailboxes_email_normalized unique (email_normalized)
);

create table if not exists mailbox_credentials (
  mailbox_id bigint primary key references mailboxes(id) on delete cascade,

  password_ciphertext text not null,
  auth_token_ciphertext text,

  secret_version integer not null default 1,
  updated_at timestamptz not null default now()
);

create table if not exists mailbox_messages (
  id bigint generated always as identity primary key,
  mailbox_id bigint not null references mailboxes(id) on delete cascade,

  message_uid text,
  from_address text not null,
  subject text not null default '',
  snippet text not null default '',
  category text not null default 'notification'
    check (category in ('verification', 'security', 'notification', 'other')),

  verification_code text,
  is_read boolean not null default false,
  received_at timestamptz not null,

  raw_payload jsonb,
  created_at timestamptz not null default now(),

  constraint uq_mailbox_message_uid unique (mailbox_id, message_uid)
);

create table if not exists mailbox_check_runs (
  id bigint generated always as identity primary key,
  mailbox_id bigint not null references mailboxes(id) on delete cascade,

  trigger_source text not null default 'manual'
    check (trigger_source in ('manual', 'scheduled', 'sync')),

  status text not null
    check (status in ('pending', 'running', 'success', 'failed')),

  health_status_after text
    check (health_status_after in ('unknown', 'healthy', 'warning', 'invalid')),

  auth_status_after text
    check (auth_status_after in ('unknown', 'valid', 'expiring', 'needs_refresh', 'reauth_required')),

  checked_at timestamptz,
  error_message text,
  created_at timestamptz not null default now()
);

-- 邮箱表索引
create index if not exists idx_mailboxes_status_updated
  on mailboxes (health_status, updated_at desc)
  where deleted_at is null;

create index if not exists idx_mailboxes_auth_status_updated
  on mailboxes (auth_status, updated_at desc)
  where deleted_at is null;

create index if not exists idx_mailboxes_latest_message
  on mailboxes (latest_message_at desc nulls last, id desc)
  where deleted_at is null;

create index if not exists idx_mailboxes_last_checked
  on mailboxes (last_checked_at desc nulls last, id desc)
  where deleted_at is null;

create index if not exists idx_mailboxes_domain
  on mailboxes (email_domain)
  where deleted_at is null;

create index if not exists idx_mailboxes_email_trgm
  on mailboxes using gin (email_normalized gin_trgm_ops)
  where deleted_at is null;

create index if not exists idx_mailbox_messages_mailbox_received
  on mailbox_messages (mailbox_id, received_at desc);

create index if not exists idx_mailbox_messages_mailbox_unread_received
  on mailbox_messages (mailbox_id, is_read, received_at desc);

create index if not exists idx_mailbox_check_runs_mailbox_created
  on mailbox_check_runs (mailbox_id, created_at desc);

-- 3. 邮箱服务提供商表 (email_providers_v1.sql)
create table if not exists email_providers (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,

  provider_type text not null
    check (provider_type in ('moemail', 'duckmail', 'mailcow', 'mailtm', 'custom')),

  name text not null,
  description text default '',

  api_url text not null,
  api_key_ciphertext text,

  config jsonb default '{}'::jsonb,

  status text not null default 'active'
    check (status in ('active', 'inactive', 'error')),

  is_default boolean default false,

  last_health_check_at timestamptz,
  health_check_status text
    check (health_check_status in ('healthy', 'degraded', 'down')),
  health_check_message text,

  total_mailboxes_created integer default 0,
  total_api_calls integer default 0,
  last_used_at timestamptz,

  secret_version integer not null default 1,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,

  constraint uq_email_providers_name unique (name)
);

create table if not exists email_provider_usage_logs (
  id bigint generated always as identity primary key,
  provider_id bigint not null references email_providers(id) on delete cascade,

  action text not null
    check (action in ('create_mailbox', 'fetch_messages', 'health_check', 'api_call')),

  success boolean not null,
  response_time_ms integer,
  error_message text,

  request_details jsonb default '{}'::jsonb,

  created_at timestamptz not null default now()
);

-- 邮箱服务提供商索引
create index if not exists idx_email_providers_type_status
  on email_providers (provider_type, status)
  where deleted_at is null;

create index if not exists idx_email_providers_default
  on email_providers (is_default)
  where deleted_at is null and is_default = true;

create index if not exists idx_email_provider_usage_logs_provider_created
  on email_provider_usage_logs (provider_id, created_at desc);

-- 4. ChatGPT 账号表 (chatgpt_accounts_v1.sql)
create table if not exists chatgpt_accounts (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,

  email text not null unique,
  email_normalized text not null,

  mailbox_id bigint references mailboxes(id) on delete set null,

  status text not null default 'pending'
    check (status in ('pending', 'active', 'suspended', 'failed', 'expired')),

  oauth_account_id text,
  oauth_issuer text,

  health_status text not null default 'unknown'
    check (health_status in ('unknown', 'healthy', 'warning', 'invalid')),

  last_checked_at timestamptz,
  last_check_result text,

  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,

  registration_source text not null default 'manual'
    check (registration_source in ('manual', 'batch_register', 'batch_login', 'import')),

  metadata jsonb default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,

  constraint uq_chatgpt_accounts_email_normalized unique (email_normalized)
);

create table if not exists chatgpt_account_credentials (
  account_id bigint primary key references chatgpt_accounts(id) on delete cascade,

  password_ciphertext text not null,

  access_token_ciphertext text,
  refresh_token_ciphertext text,
  id_token_ciphertext text,

  session_token_ciphertext text,

  secret_version integer not null default 1,

  updated_at timestamptz not null default now()
);

create table if not exists chatgpt_account_check_runs (
  id bigint generated always as identity primary key,
  account_id bigint not null references chatgpt_accounts(id) on delete cascade,

  trigger_source text not null default 'manual'
    check (trigger_source in ('manual', 'scheduled', 'batch_login', 'health_check')),

  status text not null
    check (status in ('pending', 'running', 'success', 'failed')),

  health_status_after text
    check (health_status_after in ('unknown', 'healthy', 'warning', 'invalid')),

  token_refreshed boolean default false,

  checked_at timestamptz,
  error_message text,

  logs jsonb default '[]'::jsonb,

  created_at timestamptz not null default now()
);

create table if not exists chatgpt_account_usage_logs (
  id bigint generated always as identity primary key,
  account_id bigint not null references chatgpt_accounts(id) on delete cascade,

  action text not null
    check (action in ('login', 'token_refresh', 'api_call', 'checkout', 'subscription')),

  success boolean not null,
  error_message text,

  details jsonb default '{}'::jsonb,

  created_at timestamptz not null default now()
);

-- ChatGPT 账号索引
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

-- 5. 触发器函数
create or replace function update_chatgpt_account_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create or replace function ensure_single_default_email_provider()
returns trigger as $$
begin
  if new.is_default = true then
    update email_providers
    set is_default = false
    where provider_type = new.provider_type
      and id != new.id
      and is_default = true
      and deleted_at is null;
  end if;
  return new;
end;
$$ language plpgsql;

-- 6. 触发器
create trigger trigger_chatgpt_accounts_updated_at
  before update on chatgpt_accounts
  for each row
  execute function update_chatgpt_account_updated_at();

create trigger trigger_chatgpt_account_credentials_updated_at
  before update on chatgpt_account_credentials
  for each row
  execute function update_chatgpt_account_updated_at();

create trigger trigger_email_providers_updated_at
  before update on email_providers
  for each row
  execute function update_chatgpt_account_updated_at();

create trigger trigger_ensure_single_default_email_provider
  before insert or update on email_providers
  for each row
  when (new.is_default = true)
  execute function ensure_single_default_email_provider();

-- 7. 视图
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
