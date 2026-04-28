import { NextResponse } from "next/server";
import { upsertSub2ApiGroupSetting } from "@/lib/sub2api-sites/repository";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string; groupId: string }> }
) {
  try {
    const { id: idStr, groupId: groupIdStr } = await params;
    const body = await request.json().catch(() => ({}));
    const siteId = Number.parseInt(idStr, 10);
    const groupId = Number.parseInt(groupIdStr, 10);
    const threshold = Number.parseInt(String(body.threshold_available ?? 0), 10);

    if (!Number.isFinite(siteId) || siteId <= 0 || !Number.isFinite(groupId) || groupId <= 0) {
      return NextResponse.json({ error: "Invalid site or group id" }, { status: 400 });
    }
    if (!Number.isFinite(threshold) || threshold < 0) {
      return NextResponse.json({ error: "threshold_available must be >= 0" }, { status: 400 });
    }

    const setting = await upsertSub2ApiGroupSetting(siteId, groupId, {
      threshold_available: threshold,
    });

    return NextResponse.json({ setting });
  } catch (error) {
    console.error("Failed to update sub2api group threshold:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update threshold" },
      { status: 500 }
    );
  }
}
