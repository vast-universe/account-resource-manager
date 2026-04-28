import { NextResponse } from "next/server";
import { fetchMoeMailboxes } from "@/lib/moemail/client";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const cursor = searchParams.get("cursor") || undefined;

    const result = await fetchMoeMailboxes(cursor);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Failed to fetch MoeMail mailboxes:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch mailboxes" },
      { status: 500 }
    );
  }
}
