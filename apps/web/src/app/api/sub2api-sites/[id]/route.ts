import { NextResponse } from "next/server";
import {
  deleteSub2ApiSite,
  getSub2ApiSiteById,
  updateSub2ApiSite,
} from "@/lib/sub2api-sites/repository";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: idStr } = await params;
    const site = await getSub2ApiSiteById(Number.parseInt(idStr, 10));

    if (!site) {
      return NextResponse.json({ error: "Site not found" }, { status: 404 });
    }

    return NextResponse.json({ site });
  } catch (error) {
    console.error("Failed to get sub2api site:", error);
    return NextResponse.json(
      { error: "Failed to get sub2api site" },
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
    const body = await request.json();
    const site = await updateSub2ApiSite(Number.parseInt(idStr, 10), body);

    if (!site) {
      return NextResponse.json({ error: "Site not found" }, { status: 404 });
    }

    return NextResponse.json({ site });
  } catch (error) {
    console.error("Failed to update sub2api site:", error);
    return NextResponse.json(
      { error: "Failed to update sub2api site" },
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
    const success = await deleteSub2ApiSite(Number.parseInt(idStr, 10));

    if (!success) {
      return NextResponse.json({ error: "Site not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete sub2api site:", error);
    return NextResponse.json(
      { error: "Failed to delete sub2api site" },
      { status: 500 }
    );
  }
}
