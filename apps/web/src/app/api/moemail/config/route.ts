import { NextResponse } from "next/server";
import { createMoeMailClient } from "@/lib/moemail/client";

export async function GET() {
  try {
    const client = await createMoeMailClient();

    if (!client) {
      return NextResponse.json(
        { error: "MoeMail provider not configured" },
        { status: 500 }
      );
    }

    const config = await client.getConfig();
    return NextResponse.json(config);
  } catch (error) {
    console.error("Failed to fetch MoeMail config:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch config" },
      { status: 500 }
    );
  }
}
