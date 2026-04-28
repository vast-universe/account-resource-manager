-- 邮箱服务提供商配置表
-- 用于统一管理 MoeMail、DuckMail、Mailcow 等服务的 API 配置

create table if not exists email_providers (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,

  -- 提供商信息
  provider_type text not null
    check (provider_type in ('moemail', 'duckmail', 'mailcow', 'mailtm', 'custom')),

  name text not null,
  description text default '',

  -- API 配置
  api_url text not null,
  api_key_ciphertext text,  -- 加密存储

  -- 额外配置 (JSON 格式)
  config jsonb default '{}'::jsonb,
  -- 例如: {"timeout": 15, "max_retries": 3, "imap_host": "..."}

  -- 状态
  status text not null default 'active'
    check (status in ('active', 'inactive', 'error')),

  is_default boolean default false,  -- 是否为默认提供商

  -- 健康检查
  last_health_check_at timestamptz,
  health_check_status text
    check (health_check_status in ('healthy', 'degraded', 'down')),
  health_check_message text,

  -- 使用统计
  total_mailboxes_created integer default 0,
  total_api_calls integer default 0,
  last_used_at timestamptz,

  -- 加密版本
  secret_version integer not null default 1,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,

  constraint uq_email_providers_name unique (name)
);

-- 提供商使用日志
create table if not exists email_provider_usage_logs (
  id bigint generated always as identity primary key,
  provider_id bigint not null references email_providers(id) on delete cascade,

  action text not null
    check (action in ('create_mailbox', 'fetch_messages', 'health_check', 'api_call')),

  success boolean not null,
  response_time_ms integer,
  error_message text,

  -- 请求详情
  request_details jsonb default '{}'::jsonb,

  created_at timestamptz not null default now()
);

-- 索引
create index if not exists idx_email_providers_type_status
  on email_providers (provider_type, status)
  where deleted_at is null;

create index if not exists idx_email_providers_default
  on email_providers (is_default)
  where deleted_at is null and is_default = true;

create index if not exists idx_email_provider_usage_logs_provider_created
  on email_provider_usage_logs (provider_id, created_at desc);

-- 触发器：确保只有一个默认提供商
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

create trigger trigger_ensure_single_default_email_provider
  before insert or update on email_providers
  for each row
  when (new.is_default = true)
  execute function ensure_single_default_email_provider();

-- 触发器：自动更新 updated_at
create trigger trigger_email_providers_updated_at
  before update on email_providers
  for each row
  execute function update_chatgpt_account_updated_at();

-- 初始化 MoeMail 配置 (示例)
insert into email_providers (
  provider_type,
  name,
  description,
  api_url,
  api_key_ciphertext,
  is_default,
  status
) values (
  'moemail',
  'MoeMail 默认',
  'MoeMail 临时邮箱服务',
  'https://moemail-4gj.pages.dev',
  pgp_sym_encrypt('mk_ZrcAU7m_-ksnXKSmOv-uNqL4NBrzuifT', current_setting('app.encryption_key', true)),
  true,
  'active'
) on conflict (name) do nothing;
