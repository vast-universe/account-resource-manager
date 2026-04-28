import { NextResponse } from "next/server";

const WORKER_API_BASE = process.env.WORKER_API_BASE || "http://localhost:8001";

export async function GET() {
  try {
    const res = await fetch(`${WORKER_API_BASE}/api/teams`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Failed to get teams:", error);
    return NextResponse.json(
      { error: "Failed to get teams" },
      { status: 500 }
    );
  }
}
