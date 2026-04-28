import { NextResponse } from "next/server";

const WORKER_SERVICE_URL = process.env.WORKER_SERVICE_URL || "http://localhost:8001";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const workerUrl = new URL(`${WORKER_SERVICE_URL}/api/teams/members/${id}`);

    for (const key of ["offset", "limit", "query"]) {
      const value = searchParams.get(key);
      if (value !== null) {
        workerUrl.searchParams.set(key, value);
      }
    }

    const response = await fetch(workerUrl.toString(), {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return NextResponse.json(
        { error: data.detail || data.error || "查询 Team 成员失败" },
        { status: response.status }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("Failed to fetch team members:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "查询 Team 成员失败" },
      { status: 500 }
    );
  }
}
