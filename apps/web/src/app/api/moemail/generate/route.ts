import { NextResponse } from "next/server";
import { generateMoeMailbox } from "@/lib/moemail/client";

export async function POST() {
  try {
    const result = await generateMoeMailbox();
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    console.error("Failed to generate MoeMail mailbox:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to generate mailbox" },
      { status: 500 }
    );
  }
}
