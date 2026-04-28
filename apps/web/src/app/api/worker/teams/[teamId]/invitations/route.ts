import { NextResponse } from "next/server";

const WORKER_API_BASE = process.env.WORKER_API_BASE || "http://localhost:8001";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ teamId: string }> }
) {
  try {
    const { teamId } = await params;
    const res = await fetch(`${WORKER_API_BASE}/api/teams/${teamId}/invitations`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Failed to get team invitations:", error);
    return NextResponse.json(
      { error: "Failed to get team invitations" },
      { status: 500 }
    );
  }
}
