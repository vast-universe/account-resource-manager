import { NextResponse } from "next/server";

const WORKER_SERVICE_URL = process.env.WORKER_SERVICE_URL || "http://localhost:8001";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await params;

    const response = await fetch(`${WORKER_SERVICE_URL}/api/tasks/${taskId}`);

    if (!response.ok) {
      const error = await response.json();
      return NextResponse.json(
        { error: error.detail || "获取任务状态失败" },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Failed to get task status:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "获取任务状态失败" },
      { status: 500 }
    );
  }
}
