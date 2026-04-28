import { NextResponse } from "next/server";
import {
  listEmailProviders,
  createEmailProvider,
} from "@/lib/email-providers/repository";

export async function GET() {
  try {
    const providers = await listEmailProviders();
    return NextResponse.json({ providers });
  } catch (error) {
    console.error("Failed to list email providers:", error);
    return NextResponse.json(
      { error: "Failed to list email providers" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const provider = await createEmailProvider(body);
    return NextResponse.json({ provider }, { status: 201 });
  } catch (error) {
    console.error("Failed to create email provider:", error);
    return NextResponse.json(
      { error: "Failed to create email provider" },
      { status: 500 }
    );
  }
}
