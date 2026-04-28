import "server-only";

import { getMailboxDbPool } from "@/lib/mailboxes/db";

export interface Sub2ApiSite {
  id: number;
  public_id: string;
  name: string;
  api_url: string;
  api_key_masked: string;
  default_group_ids: number[];
  status: "active" | "inactive";
  notes: string;
  created_at: Date;
  updated_at: Date;
}

export interface CreateSub2ApiSiteInput {
  name: string;
  api_url: string;
  api_key: string;
  default_group_ids?: number[];
  status?: "active" | "inactive";
  notes?: string;
}

export interface UpdateSub2ApiSiteInput {
  name?: string;
  api_url?: string;
  api_key?: string;
  default_group_ids?: number[];
  status?: "active" | "inactive";
  notes?: string;
}

type Sub2ApiSiteRow = Omit<Sub2ApiSite, "api_key_masked"> & {
  api_key: string;
};

export interface Sub2ApiSiteSecret {
  id: number;
  name: string;
  api_url: string;
  api_key: string;
}

export interface Sub2ApiGroupSetting {
  site_id: number;
  group_id: number;
  group_name: string;
  threshold_available: number;
  last_account_count: number | null;
  last_available_count: number | null;
  last_rate_limited_count: number | null;
  last_checked_at: Date | null;
  updated_at: Date;
}

function maskApiKey(apiKey: string | null | undefined) {
  const value = String(apiKey || "");
  if (!value) {
    return "";
  }
  if (value.length <= 10) {
    return `${value.slice(0, 3)}...`;
  }
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function normalizeApiUrl(raw: unknown) {
  const value = String(raw || "").trim().replace(/\/+$/, "");
  if (!value) {
    return "";
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    return value;
  }
  return `https://${value}`;
}

function normalizeGroupIds(raw: unknown): number[] {
  if (Array.isArray(raw)) {
    return Array.from(
      new Set(
        raw
          .map((item) => Number.parseInt(String(item), 10))
          .filter((item) => Number.isFinite(item) && item > 0)
      )
    );
  }

  return Array.from(
    new Set(
      String(raw || "")
        .split(",")
        .map((item) => Number.parseInt(item.trim(), 10))
        .filter((item) => Number.isFinite(item) && item > 0)
    )
  );
}

function mapSite(row: Sub2ApiSiteRow): Sub2ApiSite {
  const { api_key: apiKey, ...site } = row;
  return {
    ...site,
    default_group_ids: normalizeGroupIds(site.default_group_ids),
    api_key_masked: maskApiKey(apiKey),
  };
}

export async function ensureSub2ApiSitesTable() {
  const pool = getMailboxDbPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sub2api_sites (
      id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      public_id UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
      name TEXT NOT NULL,
      api_url TEXT NOT NULL,
      api_key TEXT NOT NULL,
      default_group_ids BIGINT[] NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'inactive')),
      notes TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ
    )
  `);
  await pool.query("ALTER TABLE sub2api_sites ADD COLUMN IF NOT EXISTS default_group_ids BIGINT[] NOT NULL DEFAULT '{}'");
  await pool.query("DROP INDEX IF EXISTS idx_sub2api_sites_default");
  await pool.query("ALTER TABLE sub2api_sites DROP COLUMN IF EXISTS is_default");
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_sub2api_sites_name_active
      ON sub2api_sites (name)
      WHERE deleted_at IS NULL
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sub2api_group_settings (
      site_id BIGINT NOT NULL REFERENCES sub2api_sites(id) ON DELETE CASCADE,
      group_id BIGINT NOT NULL,
      group_name TEXT NOT NULL DEFAULT '',
      threshold_available INTEGER NOT NULL DEFAULT 0,
      last_account_count INTEGER,
      last_available_count INTEGER,
      last_rate_limited_count INTEGER,
      last_checked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (site_id, group_id)
    )
  `);
  await pool.query(`
    ALTER TABLE sub2api_group_settings
    ADD COLUMN IF NOT EXISTS group_name TEXT NOT NULL DEFAULT ''
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chatgpt_sub2api_uploads (
      id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      account_id BIGINT NOT NULL REFERENCES chatgpt_accounts(id) ON DELETE CASCADE,
      workspace_id TEXT NOT NULL,
      workspace_name TEXT NOT NULL DEFAULT '',
      site_id BIGINT NOT NULL REFERENCES sub2api_sites(id) ON DELETE CASCADE,
      group_id BIGINT NOT NULL,
      remote_account_id BIGINT,
      remote_account_name TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'failed')),
      error_message TEXT,
      uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (account_id, workspace_id, site_id, group_id)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_chatgpt_sub2api_uploads_account
      ON chatgpt_sub2api_uploads(account_id, uploaded_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_chatgpt_sub2api_uploads_site_group
      ON chatgpt_sub2api_uploads(site_id, group_id, status)
  `);
}

export async function listSub2ApiSites(): Promise<Sub2ApiSite[]> {
  await ensureSub2ApiSitesTable();
  const pool = getMailboxDbPool();
  const result = await pool.query(
    `
    SELECT id, public_id, name, api_url, api_key, default_group_ids, status, notes, created_at, updated_at
    FROM sub2api_sites
    WHERE deleted_at IS NULL
    ORDER BY created_at DESC
    `
  );

  return result.rows.map(mapSite);
}

export async function getSub2ApiSiteById(id: number): Promise<Sub2ApiSite | null> {
  await ensureSub2ApiSitesTable();
  const pool = getMailboxDbPool();
  const result = await pool.query(
    `
    SELECT id, public_id, name, api_url, api_key, default_group_ids, status, notes, created_at, updated_at
    FROM sub2api_sites
    WHERE id = $1 AND deleted_at IS NULL
    `,
    [id]
  );

  return result.rows[0] ? mapSite(result.rows[0]) : null;
}

export async function getSub2ApiSiteSecretById(id: number): Promise<Sub2ApiSiteSecret | null> {
  await ensureSub2ApiSitesTable();
  const pool = getMailboxDbPool();
  const result = await pool.query(
    `
    SELECT id, name, api_url, api_key
    FROM sub2api_sites
    WHERE id = $1 AND deleted_at IS NULL
    `,
    [id]
  );

  return result.rows[0] || null;
}

export async function createSub2ApiSite(input: CreateSub2ApiSiteInput): Promise<Sub2ApiSite> {
  await ensureSub2ApiSitesTable();
  const pool = getMailboxDbPool();

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const result = await client.query(
      `
      INSERT INTO sub2api_sites (name, api_url, api_key, default_group_ids, status, notes)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, public_id, name, api_url, api_key, default_group_ids, status, notes, created_at, updated_at
      `,
      [
        String(input.name || "").trim(),
        normalizeApiUrl(input.api_url),
        String(input.api_key || "").trim(),
        normalizeGroupIds(input.default_group_ids),
        input.status || "active",
        input.notes || "",
      ]
    );
    await client.query("COMMIT");
    return mapSite(result.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function updateSub2ApiSite(
  id: number,
  input: UpdateSub2ApiSiteInput
): Promise<Sub2ApiSite | null> {
  await ensureSub2ApiSitesTable();
  const pool = getMailboxDbPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (input.name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(String(input.name).trim());
    }
    if (input.api_url !== undefined) {
      updates.push(`api_url = $${paramIndex++}`);
      values.push(normalizeApiUrl(input.api_url));
    }
    if (input.api_key !== undefined && String(input.api_key).trim()) {
      updates.push(`api_key = $${paramIndex++}`);
      values.push(String(input.api_key).trim());
    }
    if (input.default_group_ids !== undefined) {
      updates.push(`default_group_ids = $${paramIndex++}`);
      values.push(normalizeGroupIds(input.default_group_ids));
    }
    if (input.status !== undefined) {
      updates.push(`status = $${paramIndex++}`);
      values.push(input.status);
    }
    if (input.notes !== undefined) {
      updates.push(`notes = $${paramIndex++}`);
      values.push(input.notes);
    }

    if (updates.length === 0) {
      await client.query("COMMIT");
      return getSub2ApiSiteById(id);
    }

    updates.push("updated_at = NOW()");
    values.push(id);

    const result = await client.query(
      `
      UPDATE sub2api_sites
      SET ${updates.join(", ")}
      WHERE id = $${paramIndex} AND deleted_at IS NULL
      RETURNING id, public_id, name, api_url, api_key, default_group_ids, status, notes, created_at, updated_at
      `,
      values
    );
    await client.query("COMMIT");
    return result.rows[0] ? mapSite(result.rows[0]) : null;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteSub2ApiSite(id: number): Promise<boolean> {
  await ensureSub2ApiSitesTable();
  const pool = getMailboxDbPool();
  const result = await pool.query(
    `
    UPDATE sub2api_sites
    SET deleted_at = NOW(), updated_at = NOW()
    WHERE id = $1 AND deleted_at IS NULL
    RETURNING id
    `,
    [id]
  );

  return (result.rowCount ?? 0) > 0;
}

export async function listSub2ApiGroupSettings(siteId: number): Promise<Sub2ApiGroupSetting[]> {
  await ensureSub2ApiSitesTable();
  const pool = getMailboxDbPool();
  const result = await pool.query(
    `
    SELECT
      site_id, group_id, threshold_available,
      group_name, last_account_count, last_available_count, last_rate_limited_count,
      last_checked_at, updated_at
    FROM sub2api_group_settings
    WHERE site_id = $1
    ORDER BY group_id ASC
    `,
    [siteId]
  );

  return result.rows;
}

export async function upsertSub2ApiGroupSetting(
  siteId: number,
  groupId: number,
  input: {
    group_name?: string;
    threshold_available?: number;
    last_account_count?: number;
    last_available_count?: number;
    last_rate_limited_count?: number;
    last_checked_at?: Date;
  }
): Promise<Sub2ApiGroupSetting> {
  await ensureSub2ApiSitesTable();
  const pool = getMailboxDbPool();
  const hasThreshold = input.threshold_available !== undefined;
  const result = await pool.query(
    `
    INSERT INTO sub2api_group_settings (
      site_id, group_id, group_name, threshold_available,
      last_account_count, last_available_count, last_rate_limited_count, last_checked_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (site_id, group_id) DO UPDATE
    SET
      group_name = COALESCE(NULLIF(EXCLUDED.group_name, ''), sub2api_group_settings.group_name),
      threshold_available = CASE
        WHEN $9 THEN EXCLUDED.threshold_available
        ELSE sub2api_group_settings.threshold_available
      END,
      last_account_count = COALESCE(EXCLUDED.last_account_count, sub2api_group_settings.last_account_count),
      last_available_count = COALESCE(EXCLUDED.last_available_count, sub2api_group_settings.last_available_count),
      last_rate_limited_count = COALESCE(EXCLUDED.last_rate_limited_count, sub2api_group_settings.last_rate_limited_count),
      last_checked_at = COALESCE(EXCLUDED.last_checked_at, sub2api_group_settings.last_checked_at),
      updated_at = NOW()
    RETURNING
      site_id, group_id, group_name, threshold_available,
      last_account_count, last_available_count, last_rate_limited_count,
      last_checked_at, updated_at
    `,
    [
      siteId,
      groupId,
      input.group_name ?? "",
      input.threshold_available ?? 0,
      input.last_account_count ?? null,
      input.last_available_count ?? null,
      input.last_rate_limited_count ?? null,
      input.last_checked_at ?? null,
      hasThreshold,
    ]
  );

  return result.rows[0];
}
