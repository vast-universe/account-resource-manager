import { NextResponse } from "next/server";
import {
  getSub2ApiSiteSecretById,
  listSub2ApiGroupSettings,
  upsertSub2ApiGroupSetting,
} from "@/lib/sub2api-sites/repository";

type Sub2ApiGroup = {
  id: number;
  name: string;
  description?: string;
  platform?: string;
  status?: string;
  is_exclusive?: boolean;
  account_count?: number;
  active_account_count?: number;
  rate_limited_account_count?: number;
};

function normalizeGroupsPayload(payload: unknown): Sub2ApiGroup[] {
  if (Array.isArray(payload)) {
    return payload as Sub2ApiGroup[];
  }
  if (payload && typeof payload === "object") {
    const data = (payload as { data?: unknown }).data;
    if (Array.isArray(data)) {
      return data as Sub2ApiGroup[];
    }
    if (data && typeof data === "object") {
      const items = (data as { items?: unknown }).items;
      if (Array.isArray(items)) {
        return items as Sub2ApiGroup[];
      }
    }
  }
  return [];
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: idStr } = await params;
    const site = await getSub2ApiSiteSecretById(Number.parseInt(idStr, 10));

    if (!site) {
      return NextResponse.json({ error: "Site not found" }, { status: 404 });
    }

    const url = new URL(`${site.api_url.replace(/\/+$/, "")}/api/v1/admin/groups/all`);
    url.searchParams.set("platform", "openai");

    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "x-api-key": site.api_key,
      },
      cache: "no-store",
    });
    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      return NextResponse.json(
        {
          error:
            (payload && typeof payload === "object" && "message" in payload
              ? String(payload.message)
              : "") || `Sub2API returned HTTP ${response.status}`,
        },
        { status: response.status }
      );
    }

    const siteId = Number.parseInt(idStr, 10);
    const settings = await listSub2ApiGroupSettings(siteId);
    const settingsByGroupId = new Map(settings.map((setting) => [Number(setting.group_id), setting]));
    const groups = await Promise.all(normalizeGroupsPayload(payload).map(async (group) => {
      const groupId = Number(group.id);
      const activeCount = Number(group.active_account_count || 0);
      const rateLimitedCount = Number(group.rate_limited_account_count || 0);
      const availableCount = Math.max(activeCount - rateLimitedCount, 0);
      const setting = settingsByGroupId.get(groupId);
      const savedSetting = await upsertSub2ApiGroupSetting(siteId, groupId, {
        group_name: String(group.name || ""),
        last_account_count: Number(group.account_count || 0),
        last_available_count: availableCount,
        last_rate_limited_count: rateLimitedCount,
        last_checked_at: new Date(),
      });

      return {
        ...group,
        threshold_available: savedSetting.threshold_available ?? setting?.threshold_available ?? 0,
        last_account_count: savedSetting.last_account_count,
        last_available_count: savedSetting.last_available_count,
        last_rate_limited_count: savedSetting.last_rate_limited_count,
        last_checked_at: savedSetting.last_checked_at,
      };
    }));

    return NextResponse.json({ groups });
  } catch (error) {
    console.error("Failed to fetch sub2api groups:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch sub2api groups" },
      { status: 500 }
    );
  }
}
