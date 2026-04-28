import { NextResponse } from "next/server";
import {
  getEmailProviderById,
  updateEmailProvider,
  deleteEmailProvider,
  updateProviderHealthCheck,
} from "@/lib/email-providers/repository";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: idStr } = await params;
    const id = parseInt(idStr);
    const provider = await getEmailProviderById(id);

    if (!provider) {
      return NextResponse.json(
        { error: "Provider not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ provider });
  } catch (error) {
    console.error("Failed to get email provider:", error);
    return NextResponse.json(
      { error: "Failed to get email provider" },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: idStr } = await params;
    const id = parseInt(idStr);
    const body = await request.json();
    const provider = await updateEmailProvider(id, body);

    if (!provider) {
      return NextResponse.json(
        { error: "Provider not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ provider });
  } catch (error) {
    console.error("Failed to update email provider:", error);
    return NextResponse.json(
      { error: "Failed to update email provider" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: idStr } = await params;
    const id = parseInt(idStr);
    const success = await deleteEmailProvider(id);

    if (!success) {
      return NextResponse.json(
        { error: "Provider not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete email provider:", error);
    return NextResponse.json(
      { error: "Failed to delete email provider" },
      { status: 500 }
    );
  }
}
