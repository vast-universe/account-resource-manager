import { NextResponse } from "next/server";
import { fetchMoeMailMessages } from "@/lib/moemail/client";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ emailId: string }> }
) {
  try {
    const { emailId } = await params;

    if (!emailId) {
      return NextResponse.json({ error: "Email ID is required" }, { status: 400 });
    }

    const messages = await fetchMoeMailMessages(emailId);

    return NextResponse.json({ messages });
  } catch (error) {
    console.error("Failed to fetch MoeMail messages:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch messages" },
      { status: 500 }
    );
  }
}
