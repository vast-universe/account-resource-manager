import { NextResponse } from "next/server";
import { getMailboxDbPool } from "@/lib/mailboxes/db";

interface WorkspaceToken {
  workspace_id?: string;
  plan_type?: string;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const workspaceId = typeof body.workspace_id === "string" ? body.workspace_id.trim() : "";

    if (!workspaceId) {
      return NextResponse.json({ error: "缺少 workspace_id" }, { status: 400 });
    }

    const pool = getMailboxDbPool();
    const accountResult = await pool.query(
      `
      SELECT id, workspace_tokens
      FROM chatgpt_accounts
      WHERE id = $1 AND deleted_at IS NULL
      LIMIT 1
      `,
      [id]
    );

    if (accountResult.rowCount === 0) {
      return NextResponse.json({ error: "账号不存在" }, { status: 404 });
    }

    const workspaceTokens = Array.isArray(accountResult.rows[0].workspace_tokens)
      ? accountResult.rows[0].workspace_tokens as WorkspaceToken[]
      : [];
    const matchedWorkspace = workspaceTokens.find((workspace) => {
      return workspace.workspace_id === workspaceId && workspace.plan_type === "team";
    });

    if (!matchedWorkspace) {
      return NextResponse.json(
        { error: "只能设置该账号已提取到的 Team workspace" },
        { status: 400 }
      );
    }

    await pool.query(
      `
      UPDATE chatgpt_accounts
      SET
        team_workspace_id = $2,
        team_member_count = NULL,
        team_members = '[]'::jsonb,
        team_members_refreshed_at = NULL,
        updated_at = NOW()
      WHERE id = $1 AND deleted_at IS NULL
      `,
      [id, workspaceId]
    );

    return NextResponse.json({
      success: true,
      account_id: Number(id),
      team_workspace_id: workspaceId,
    });
  } catch (error) {
    console.error("Failed to update team workspace:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "设置母号 Team 空间失败" },
      { status: 500 }
    );
  }
}
