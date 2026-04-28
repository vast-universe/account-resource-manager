import { NextResponse } from "next/server";

const WORKER_SERVICE_URL = process.env.WORKER_SERVICE_URL || "http://localhost:8001";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const invitedAccountIds = Array.isArray(body.invited_account_ids)
      ? body.invited_account_ids.map(Number).filter((value: number) => Number.isFinite(value))
      : [];

    if (invitedAccountIds.length === 0) {
      return NextResponse.json({ error: "请选择要邀请的账号" }, { status: 400 });
    }

    const response = await fetch(`${WORKER_SERVICE_URL}/api/teams/invite`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mother_account_id: Number(id),
        target_account_ids: invitedAccountIds,
        accept_invites: true,
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return NextResponse.json(
        { error: data.detail || data.error || "邀请失败" },
        { status: response.status }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("Failed to invite team members:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "邀请失败" },
      { status: 500 }
    );
  }
}
