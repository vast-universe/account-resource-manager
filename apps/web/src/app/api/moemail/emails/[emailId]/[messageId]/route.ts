import { NextResponse } from "next/server";
import { fetchMoeMailMessageDetail } from "@/lib/moemail/client";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ emailId: string; messageId: string }> }
) {
  try {
    const { emailId, messageId } = await params;

    if (!emailId || !messageId) {
      return NextResponse.json(
        { error: "Email ID and Message ID are required" },
        { status: 400 }
      );
    }

    const message = await fetchMoeMailMessageDetail(emailId, messageId);

    if (!message) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }

    return NextResponse.json({ message });
  } catch (error) {
    console.error("Failed to fetch MoeMail message detail:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch message detail" },
      { status: 500 }
    );
  }
}
