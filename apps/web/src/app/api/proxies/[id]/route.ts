import { NextResponse } from "next/server";
import { getMailboxDbPool } from "@/lib/mailboxes/db";

function normalizeProxyUrl(raw: unknown) {
  if (raw === undefined || raw === null) {
    return raw;
  }
  const value = String(raw).trim();
  if (!value) {
    return value;
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    return value;
  }
  return `http://${value}`;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: idStr } = await params;
    const id = parseInt(idStr);
    const pool = getMailboxDbPool();
    const result = await pool.query(
      `SELECT
         id, public_id, name, url, is_active,
         latency_ms, success_count, failure_count,
         last_success_at, last_failure_at, last_checked_at, last_error,
         created_at, updated_at
       FROM proxies
       WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "Proxy not found" }, { status: 404 });
    }

    return NextResponse.json({ proxy: result.rows[0] });
  } catch (error) {
    console.error("Failed to get proxy:", error);
    return NextResponse.json(
      { error: "Failed to get proxy" },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: idStr } = await params;
    const id = parseInt(idStr);
    const body = await request.json();
    const { name, url, is_active } = body;

    const pool = getMailboxDbPool();
    const result = await pool.query(
      `UPDATE proxies
       SET name = COALESCE($1, name),
           url = COALESCE($2, url),
           is_active = COALESCE($3, is_active),
           updated_at = NOW()
       WHERE id = $4 AND deleted_at IS NULL
       RETURNING
         id, public_id, name, url, is_active,
         latency_ms, success_count, failure_count,
         last_success_at, last_failure_at, last_checked_at, last_error,
         created_at, updated_at`,
      [name, normalizeProxyUrl(url), is_active, id]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "Proxy not found" }, { status: 404 });
    }

    return NextResponse.json({ proxy: result.rows[0] });
  } catch (error) {
    console.error("Failed to update proxy:", error);
    return NextResponse.json(
      { error: "Failed to update proxy" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: idStr } = await params;
    const id = parseInt(idStr);
    const pool = getMailboxDbPool();
    const result = await pool.query(
      `UPDATE proxies
       SET deleted_at = NOW()
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING id`,
      [id]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "Proxy not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete proxy:", error);
    return NextResponse.json(
      { error: "Failed to delete proxy" },
      { status: 500 }
    );
  }
}
