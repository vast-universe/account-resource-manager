import { NextResponse } from "next/server";
import { createMoeMailClient } from "@/lib/moemail/client";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ emailId: string }> }
) {
  try {
    const { emailId } = await params;

    if (!emailId) {
      return NextResponse.json({ error: "Email ID is required" }, { status: 400 });
    }

    const client = await createMoeMailClient();

    if (!client) {
      return NextResponse.json(
        { error: "MoeMail provider not configured" },
        { status: 500 }
      );
    }

    await client.deleteEmail(emailId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete email:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete email" },
      { status: 500 }
    );
  }
}
