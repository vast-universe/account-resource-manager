-- MoeMail 邮箱记录表
-- 用于记录通过 MoeMail 创建的邮箱 ID

create table if not exists moemail_mailboxes (
  id bigint generated always as identity primary key,

  email_id text not null unique,  -- MoeMail 邮箱 ID
  email text not null,             -- 完整邮箱地址
  password text,                   -- 邮箱密码（如果有）

  provider_id bigint references email_providers(id) on delete set null,

  message_count integer default 0,
  last_checked_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_moemail_mailboxes_email_id
  on moemail_mailboxes (email_id)
  where deleted_at is null;

create index if not exists idx_moemail_mailboxes_created
  on moemail_mailboxes (created_at desc)
  where deleted_at is null;
