import { NextResponse } from "next/server";

const WORKER_SERVICE_URL = process.env.WORKER_SERVICE_URL || "http://localhost:8001";

async function exportSub2api(request?: Request) {
  try {
    const body = request ? await request.json().catch(() => ({})) : {};
    const accountIds = Array.isArray(body.account_ids)
      ? body.account_ids.map(Number).filter((value: number) => Number.isFinite(value))
      : [];

    const response = await fetch(`${WORKER_SERVICE_URL}/api/chatgpt/export-sub2api`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ account_ids: accountIds }),
    });

    if (!response.ok) {
      const error = await response.json();
      return NextResponse.json(
        { error: error.detail || "导出失败" },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Failed to export sub2api:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "导出失败" },
      { status: 500 }
    );
  }
}

export async function GET() {
  return exportSub2api();
}

export async function POST(request: Request) {
  return exportSub2api(request);
}
