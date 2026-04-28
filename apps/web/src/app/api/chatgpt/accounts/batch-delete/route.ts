import { NextResponse } from "next/server";
import { getMailboxDbPool } from "@/lib/mailboxes/db";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { ids } = body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json(
        { error: "Missing or invalid account ids" },
        { status: 400 }
      );
    }

    const pool = getMailboxDbPool();

    const placeholders = ids.map((_, index) => `$${index + 1}`).join(", ");
    const result = await pool.query(
      `UPDATE chatgpt_accounts SET deleted_at = NOW() WHERE id IN (${placeholders}) AND deleted_at IS NULL RETURNING id`,
      ids
    );

    return NextResponse.json({
      success: true,
      deleted_count: result.rowCount,
      deleted_ids: result.rows.map(row => row.id),
    });
  } catch (error) {
    console.error("Failed to batch delete ChatGPT accounts:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to batch delete accounts" },
      { status: 500 }
    );
  }
}
