create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

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
