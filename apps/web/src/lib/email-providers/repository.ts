import "server-only";

import type { PoolClient } from "pg";
import { getMailboxDbPool } from "@/lib/mailboxes/db";

export interface EmailProvider {
  id: number;
  public_id: string;
  provider_type: string;
  name: string;
  description: string;
  api_url: string;
  status: string;
  is_default: boolean;
  health_check_status?: string;
  health_check_message?: string;
  total_mailboxes_created: number;
  last_used_at?: Date;
  created_at: Date;
  updated_at: Date;
}

export interface CreateEmailProviderInput {
  provider_type: string;
  name: string;
  description?: string;
  api_url: string;
  api_key: string;
  status?: string;
  is_default?: boolean;
  config?: Record<string, any>;
}

export interface UpdateEmailProviderInput {
  name?: string;
  description?: string;
  api_url?: string;
  api_key?: string;
  status?: string;
  is_default?: boolean;
  config?: Record<string, any>;
}

export async function listEmailProviders(): Promise<EmailProvider[]> {
  const pool = getMailboxDbPool();
  const result = await pool.query(
    `
    select
      id, public_id, provider_type, name, description,
      api_url, status, is_default,
      health_check_status, health_check_message,
      total_mailboxes_created, last_used_at,
      created_at, updated_at
    from email_providers
    where deleted_at is null
    order by is_default desc, created_at desc
    `
  );

  return result.rows;
}

export async function getEmailProviderById(id: number): Promise<EmailProvider | null> {
  const pool = getMailboxDbPool();
  const result = await pool.query(
    `
    select
      id, public_id, provider_type, name, description,
      api_url, status, is_default,
      health_check_status, health_check_message,
      total_mailboxes_created, last_used_at,
      created_at, updated_at
    from email_providers
    where id = $1 and deleted_at is null
    `,
    [id]
  );

  return result.rows[0] || null;
}

export async function getEmailProviderApiKey(id: number): Promise<string | null> {
  const pool = getMailboxDbPool();
  const result = await pool.query(
    `
    select api_key
    from email_providers
    where id = $1 and deleted_at is null
    `,
    [id]
  );

  return result.rows[0]?.api_key || null;
}

export async function getDefaultEmailProvider(
  providerType: string
): Promise<EmailProvider | null> {
  const pool = getMailboxDbPool();
  const result = await pool.query(
    `
    select
      id, public_id, provider_type, name, description,
      api_url, status, is_default,
      health_check_status, health_check_message,
      total_mailboxes_created, last_used_at,
      created_at, updated_at
    from email_providers
    where provider_type = $1
      and is_default = true
      and status = 'active'
      and deleted_at is null
    limit 1
    `,
    [providerType]
  );

  return result.rows[0] || null;
}

export async function createEmailProvider(
  input: CreateEmailProviderInput
): Promise<EmailProvider> {
  const pool = getMailboxDbPool();

  const result = await pool.query(
    `
    insert into email_providers (
      provider_type, name, description, api_url,
      api_key, status, is_default, config
    ) values ($1, $2, $3, $4, $5, $6, $7, $8)
    returning
      id, public_id, provider_type, name, description,
      api_url, status, is_default,
      total_mailboxes_created, created_at, updated_at
    `,
    [
      input.provider_type,
      input.name,
      input.description || "",
      input.api_url,
      input.api_key,
      input.status || "active",
      input.is_default || false,
      JSON.stringify(input.config || {}),
    ]
  );

  return result.rows[0];
}

export async function updateEmailProvider(
  id: number,
  input: UpdateEmailProviderInput
): Promise<EmailProvider | null> {
  const pool = getMailboxDbPool();
  const updates: string[] = [];
  const values: any[] = [];
  let paramIndex = 1;

  if (input.name !== undefined) {
    updates.push(`name = $${paramIndex++}`);
    values.push(input.name);
  }

  if (input.description !== undefined) {
    updates.push(`description = $${paramIndex++}`);
    values.push(input.description);
  }

  if (input.api_url !== undefined) {
    updates.push(`api_url = $${paramIndex++}`);
    values.push(input.api_url);
  }

  if (input.api_key !== undefined) {
    updates.push(`api_key = $${paramIndex++}`);
    values.push(input.api_key);
  }

  if (input.status !== undefined) {
    updates.push(`status = $${paramIndex++}`);
    values.push(input.status);
  }

  if (input.is_default !== undefined) {
    updates.push(`is_default = $${paramIndex++}`);
    values.push(input.is_default);
  }

  if (input.config !== undefined) {
    updates.push(`config = $${paramIndex++}`);
    values.push(JSON.stringify(input.config));
  }

  if (updates.length === 0) {
    return getEmailProviderById(id);
  }

  values.push(id);

  const result = await pool.query(
    `
    update email_providers
    set ${updates.join(", ")}
    where id = $${paramIndex} and deleted_at is null
    returning
      id, public_id, provider_type, name, description,
      api_url, status, is_default,
      total_mailboxes_created, created_at, updated_at
    `,
    values
  );

  return result.rows[0] || null;
}

export async function deleteEmailProvider(id: number): Promise<boolean> {
  const pool = getMailboxDbPool();
  const result = await pool.query(
    `
    update email_providers
    set deleted_at = now()
    where id = $1 and deleted_at is null
    `,
    [id]
  );

  return (result.rowCount ?? 0) > 0;
}

export async function updateProviderHealthCheck(
  id: number,
  status: "healthy" | "degraded" | "down",
  message?: string
): Promise<void> {
  const pool = getMailboxDbPool();
  await pool.query(
    `
    update email_providers
    set
      health_check_status = $1,
      health_check_message = $2,
      last_health_check_at = now()
    where id = $3
    `,
    [status, message || null, id]
  );
}

export async function incrementProviderUsage(
  id: number,
  action: string
): Promise<void> {
  const pool = getMailboxDbPool();
  await pool.query(
    `
    update email_providers
    set
      total_api_calls = total_api_calls + 1,
      last_used_at = now()
    where id = $1
    `,
    [id]
  );

  if (action === "create_mailbox") {
    await pool.query(
      `
      update email_providers
      set total_mailboxes_created = total_mailboxes_created + 1
      where id = $1
      `,
      [id]
    );
  }
}
