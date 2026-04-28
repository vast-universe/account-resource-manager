import { NextResponse } from "next/server";
import { getMailboxDbPool } from "@/lib/mailboxes/db";
import { ensureSub2ApiSitesTable } from "@/lib/sub2api-sites/repository";

async function ensureChatGPTCardTypeColumn() {
  const pool = getMailboxDbPool();
  await pool.query("ALTER TABLE chatgpt_accounts ADD COLUMN IF NOT EXISTS card_type TEXT NOT NULL DEFAULT '短效'");
  await pool.query("UPDATE chatgpt_accounts SET card_type = '短效' WHERE card_type IS NULL OR card_type NOT IN ('短效', '长效')");
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get("limit") || "50");
    const offset = parseInt(searchParams.get("offset") || "0");
    const keyword = (searchParams.get("q") || "").trim();

    const pool = getMailboxDbPool();
    await ensureSub2ApiSitesTable();
    await ensureChatGPTCardTypeColumn();

    const filterParams: Array<string | number> = [];
    const whereClauses = ["a.deleted_at IS NULL"];

    if (keyword) {
      filterParams.push(`%${keyword}%`);
      whereClauses.push(`(a.email ILIKE $${filterParams.length} OR a.public_id::text ILIKE $${filterParams.length})`);
    }

    const whereSql = whereClauses.join(" AND ");
    const limitParamIndex = filterParams.length + 1;
    const offsetParamIndex = filterParams.length + 2;

    const result = await pool.query(
      `
      SELECT
        a.id, a.public_id, a.email, a.email_service_id, a.status, a.health_status,
        a.last_checked_at, a.access_token_expires_at, a.registration_source,
        a.checkout_url, a.team_checkout_url,
        a.exported, a.exported_at, a.region, a.subscription_type, a.card_type,
        a.created_at, a.updated_at, a.workspace_tokens, a.team_workspace_id,
        a.team_member_count, a.team_members_refreshed_at,
        a.password,
        COALESCE(
          jsonb_agg(
            DISTINCT jsonb_build_object(
              'site_id', u.site_id,
              'site_name', s.name,
              'group_id', u.group_id,
              'group_name', COALESCE(gs.group_name, ''),
              'workspace_id', u.workspace_id,
              'workspace_name', u.workspace_name,
              'status', u.status,
              'uploaded_at', u.uploaded_at
            )
          ) FILTER (WHERE u.id IS NOT NULL),
          '[]'::jsonb
        ) AS sub2api_uploads
      FROM chatgpt_accounts a
      LEFT JOIN chatgpt_sub2api_uploads u ON u.account_id = a.id
      LEFT JOIN sub2api_sites s ON s.id = u.site_id
      LEFT JOIN sub2api_group_settings gs ON gs.site_id = u.site_id AND gs.group_id = u.group_id
      WHERE ${whereSql}
      GROUP BY a.id
      ORDER BY a.created_at DESC
      LIMIT $${limitParamIndex} OFFSET $${offsetParamIndex}
      `,
      [...filterParams, limit, offset]
    );

    const countResult = await pool.query(
      `
      SELECT COUNT(*) as total
      FROM chatgpt_accounts a
      WHERE ${whereSql}
      `,
      filterParams
    );

    return NextResponse.json({
      accounts: result.rows,
      total: parseInt(countResult.rows[0].total),
      limit,
      offset,
    });
  } catch (error) {
    console.error("Failed to fetch ChatGPT accounts:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch accounts" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { error: "Missing account id" },
        { status: 400 }
      );
    }

    const pool = getMailboxDbPool();

    const result = await pool.query(
      `UPDATE chatgpt_accounts SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
      [id]
    );

    if (result.rowCount === 0) {
      return NextResponse.json(
        { error: "Account not found or already deleted" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, id });
  } catch (error) {
    console.error("Failed to delete ChatGPT account:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete account" },
      { status: 500 }
    );
  }
}
