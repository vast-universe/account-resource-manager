import { NextResponse } from "next/server";

const WORKER_SERVICE_URL = process.env.WORKER_SERVICE_URL || "http://localhost:8001";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { account_id, workspace_id } = body;

    if (!account_id) {
      return NextResponse.json(
        { error: "缺少必要参数" },
        { status: 400 }
      );
    }

    const response = await fetch(`${WORKER_SERVICE_URL}/api/chatgpt/refresh-subscription`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        account_id,
        workspace_id,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      return NextResponse.json(
        { error: error.detail || "刷新订阅失败" },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Failed to refresh ChatGPT subscription:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "刷新订阅失败" },
      { status: 500 }
    );
  }
}
