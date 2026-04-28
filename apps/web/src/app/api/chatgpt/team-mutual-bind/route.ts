import { NextResponse } from "next/server";

const WORKER_SERVICE_URL = process.env.WORKER_SERVICE_URL || process.env.WORKER_API_BASE || "http://localhost:8001";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const accountIds = Array.isArray(body.account_ids)
      ? body.account_ids.map(Number).filter((value: number) => Number.isFinite(value))
      : [];

    if (accountIds.length < 2) {
      return NextResponse.json({ error: "请至少选择 2 个账号" }, { status: 400 });
    }

    const response = await fetch(`${WORKER_SERVICE_URL}/api/teams/mutual-bind`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        account_ids: accountIds,
        accept_invites: true,
        refresh_after: body.refresh_after !== false,
        concurrency: Number(body.concurrency || 0) || 0,
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return NextResponse.json(
        { error: data.detail || data.error || "Team 互拉失败" },
        { status: response.status }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("Failed to mutual bind ChatGPT teams:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Team 互拉失败" },
      { status: 500 }
    );
  }
}
