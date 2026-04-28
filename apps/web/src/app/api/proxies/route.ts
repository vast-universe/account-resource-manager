import { NextResponse } from "next/server";
import { getMailboxDbPool } from "@/lib/mailboxes/db";

function normalizeProxyUrl(raw: unknown) {
  const value = String(raw || "").trim();
  if (!value) {
    return "";
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    return value;
  }
  return `http://${value}`;
}

function proxyName(index: number) {
  return `动态代理 ${String(index).padStart(3, "0")}`;
}

async function ensureAppSettingsTable() {
  const pool = getMailboxDbPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(
    `INSERT INTO app_settings (key, value)
     VALUES ('proxy.enabled', 'true')
     ON CONFLICT (key) DO NOTHING`
  );
}

async function getProxyEnabled() {
  await ensureAppSettingsTable();
  const pool = getMailboxDbPool();
  const result = await pool.query(
    `SELECT value FROM app_settings WHERE key = 'proxy.enabled'`
  );
  return result.rows[0]?.value !== "false";
}

export async function GET() {
  try {
    const pool = getMailboxDbPool();
    const proxyEnabled = await getProxyEnabled();
    const result = await pool.query(
      `SELECT
         id, public_id, name, url, is_active,
         latency_ms, success_count, failure_count,
         last_success_at, last_failure_at, last_checked_at, last_error,
         created_at, updated_at
       FROM proxies
       WHERE deleted_at IS NULL
       ORDER BY created_at DESC`
    );

    return NextResponse.json({ proxies: result.rows, proxy_enabled: proxyEnabled });
  } catch (error) {
    console.error("Failed to get proxies:", error);
    return NextResponse.json(
      { error: "Failed to get proxies" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const proxyEnabled = body.proxy_enabled;
    if (typeof proxyEnabled !== "boolean") {
      return NextResponse.json(
        { error: "proxy_enabled must be boolean" },
        { status: 400 }
      );
    }

    await ensureAppSettingsTable();
    const pool = getMailboxDbPool();
    await pool.query(
      `INSERT INTO app_settings (key, value)
       VALUES ('proxy.enabled', $1)
       ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value, updated_at = NOW()`,
      [proxyEnabled ? "true" : "false"]
    );

    return NextResponse.json({ proxy_enabled: proxyEnabled });
  } catch (error) {
    console.error("Failed to update proxy settings:", error);
    return NextResponse.json(
      { error: "Failed to update proxy settings" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, url, urls, is_active = true } = body;

    if (Array.isArray(urls)) {
      const normalizedUrls = Array.from(
        new Set(urls.map(normalizeProxyUrl).filter(Boolean))
      );

      if (normalizedUrls.length === 0) {
        return NextResponse.json(
          { error: "Proxy URLs are required" },
          { status: 400 }
        );
      }

      const pool = getMailboxDbPool();
      const existingResult = await pool.query(
        `SELECT url FROM proxies
         WHERE deleted_at IS NULL AND url = ANY($1::text[])`,
        [normalizedUrls]
      );
      const existingUrls = new Set(existingResult.rows.map((row) => row.url));
      const urlsToInsert = normalizedUrls.filter((item) => !existingUrls.has(item));

      if (urlsToInsert.length === 0) {
        return NextResponse.json({
          proxies: [],
          created_count: 0,
          skipped_count: normalizedUrls.length,
        });
      }

      const values: unknown[] = [];
      const placeholders = urlsToInsert.map((proxyUrl, index) => {
        values.push(proxyName(index + 1), proxyUrl, is_active);
        const base = index * 3;
        return `($${base + 1}, $${base + 2}, $${base + 3})`;
      });

      const result = await pool.query(
        `INSERT INTO proxies (name, url, is_active)
         VALUES ${placeholders.join(", ")}
         RETURNING
           id, public_id, name, url, is_active,
           latency_ms, success_count, failure_count,
           last_success_at, last_failure_at, last_checked_at, last_error,
           created_at, updated_at`,
        values
      );

      return NextResponse.json({
        proxies: result.rows,
        created_count: result.rows.length,
        skipped_count: normalizedUrls.length - urlsToInsert.length,
      });
    }

    if (!name || !url) {
      return NextResponse.json(
        { error: "Name and URL are required" },
        { status: 400 }
      );
    }

    const pool = getMailboxDbPool();
    const result = await pool.query(
      `INSERT INTO proxies (name, url, is_active)
       VALUES ($1, $2, $3)
       RETURNING
         id, public_id, name, url, is_active,
         latency_ms, success_count, failure_count,
         last_success_at, last_failure_at, last_checked_at, last_error,
         created_at, updated_at`,
      [name, normalizeProxyUrl(url), is_active]
    );

    return NextResponse.json({ proxy: result.rows[0] });
  } catch (error) {
    console.error("Failed to create proxy:", error);
    return NextResponse.json(
      { error: "Failed to create proxy" },
      { status: 500 }
    );
  }
}
