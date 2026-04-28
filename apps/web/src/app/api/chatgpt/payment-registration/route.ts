import { NextResponse } from "next/server";

const WORKER_SERVICE_URL = process.env.WORKER_SERVICE_URL || "http://localhost:8001";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { count = 30, concurrency = 5 } = body;

    const response = await fetch(`${WORKER_SERVICE_URL}/api/payment-registration`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        count,
        concurrency,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      return NextResponse.json(
        { error: error.detail || "创建支付注册任务失败" },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Failed to create payment registration task:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "创建任务失败" },
      { status: 500 }
    );
  }
}
