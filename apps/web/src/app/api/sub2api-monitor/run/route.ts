import { NextResponse } from "next/server";
import { getMailboxDbPool } from "@/lib/mailboxes/db";
import { ensureSub2ApiSitesTable } from "@/lib/sub2api-sites/repository";

type WorkspaceToken = {
  workspace_id?: string;
  workspace_name?: string;
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
  expires_in?: number;
  plan_type?: string;
};

type CandidateAccount = {
  account_id: number;
  email: string;
  card_type: "短效" | "长效";
  workspaces: WorkspaceToken[];
};

type SiteGroupSetting = {
  site_id: number;
  site_name: string;
  api_url: string;
  api_key: string;
  group_id: number;
  threshold_available: number;
};

type RemoteGroup = {
  id: number;
  account_count?: number;
  active_account_count?: number;
  rate_limited_account_count?: number;
};

function availableCount(group: RemoteGroup) {
  return Math.max(Number(group.active_account_count || 0) - Number(group.rate_limited_account_count || 0), 0);
}

function validWorkspace(workspace: WorkspaceToken) {
  const workspaceId = String(workspace.workspace_id || "").trim();
  return workspaceId && workspaceId !== "default" && workspaceId !== "global" && workspace.refresh_token;
}

function formatBatchDate(reference = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    month: "numeric",
    day: "numeric",
  }).formatToParts(reference);
  const month = parts.find((part) => part.type === "month")?.value || "";
  const day = parts.find((part) => part.type === "day")?.value || "";
  return `${month}-${day}`;
}

function normalizeCardType(cardType: unknown): "短效" | "长效" {
  return cardType === "长效" ? "长效" : "短效";
}

async function ensureChatGPTCardTypeColumn() {
  const pool = getMailboxDbPool();
  await pool.query("ALTER TABLE chatgpt_accounts ADD COLUMN IF NOT EXISTS card_type TEXT NOT NULL DEFAULT '短效'");
  await pool.query("UPDATE chatgpt_accounts SET card_type = '短效' WHERE card_type IS NULL OR card_type NOT IN ('短效', '长效')");
}

async function fetchRemoteGroups(setting: SiteGroupSetting): Promise<RemoteGroup[]> {
  const url = new URL(`${setting.api_url.replace(/\/+$/, "")}/api/v1/admin/groups/all`);
  url.searchParams.set("platform", "openai");
  const response = await fetch(url, {
    headers: { Accept: "application/json", "x-api-key": setting.api_key },
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`Sub2API groups failed: HTTP ${response.status}`);
  }
  if (Array.isArray(payload)) {
    return payload;
  }
  if (payload?.data && Array.isArray(payload.data)) {
    return payload.data;
  }
  if (payload?.data?.items && Array.isArray(payload.data.items)) {
    return payload.data.items;
  }
  return [];
}

function buildSub2ApiPayload(
  candidate: CandidateAccount,
  workspace: WorkspaceToken,
  groupId: number,
  index: number,
  batchDate: string
) {
  const workspaceId = String(workspace.workspace_id || "").trim();
  const credentials: Record<string, unknown> = {
    refresh_token: workspace.refresh_token,
    chatgpt_account_id: workspaceId,
  };

  if (workspace.access_token) {
    credentials.access_token = workspace.access_token;
    credentials._token_version = Date.now();
    credentials.email = candidate.email;
    credentials.chatgpt_user_id = "";
    if (workspace.expires_at) {
      credentials.expires_at = workspace.expires_at;
    }
    if (workspace.expires_in) {
      credentials.expires_in = workspace.expires_in;
    }
  }

  return {
    name: `${batchDate}-${candidate.card_type} #${index}`,
    notes: "",
    platform: "openai",
    type: "oauth",
    credentials,
    extra: {
      email: candidate.email,
      plan_type: workspace.plan_type || "unknown",
      card_type: candidate.card_type,
      arm_account_id: candidate.account_id,
      arm_workspace_id: workspaceId,
    },
    group_ids: [groupId],
    concurrency: 10,
    priority: 1,
    rate_multiplier: 1,
    auto_pause_on_expired: true,
    proxy_id: null,
  };
}

async function loadSettings(siteId?: number, groupId?: number): Promise<SiteGroupSetting[]> {
  const pool = getMailboxDbPool();
  const params: number[] = [];
  const filters = ["s.deleted_at IS NULL", "s.status = 'active'", "gs.threshold_available > 0"];

  if (siteId) {
    params.push(siteId);
    filters.push(`s.id = $${params.length}`);
  }
  if (groupId) {
    params.push(groupId);
    filters.push(`gs.group_id = $${params.length}`);
  }

  const result = await pool.query(
    `
    SELECT
      s.id AS site_id,
      s.name AS site_name,
      s.api_url,
      s.api_key,
      gs.group_id,
      gs.threshold_available
    FROM sub2api_group_settings gs
    JOIN sub2api_sites s ON s.id = gs.site_id
    WHERE ${filters.join(" AND ")}
    ORDER BY s.id ASC, gs.group_id ASC
    `,
    params
  );

  return result.rows;
}

async function loadCandidateAccounts(excludedAccountIds: Set<number>, requiredTokenCount: number): Promise<CandidateAccount[]> {
  const pool = getMailboxDbPool();
  await ensureChatGPTCardTypeColumn();
  const result = await pool.query(
    `
    SELECT id, email, workspace_tokens, card_type
    FROM chatgpt_accounts
    WHERE deleted_at IS NULL
      AND status = 'active'
      AND workspace_tokens IS NOT NULL
      AND workspace_tokens != '[]'::jsonb
      AND NOT (id = ANY($1::bigint[]))
      AND NOT EXISTS (
        SELECT 1
        FROM chatgpt_sub2api_uploads u
        WHERE u.account_id = chatgpt_accounts.id
          AND u.status = 'success'
      )
    ORDER BY created_at ASC
    LIMIT 500
    `,
    [Array.from(excludedAccountIds)]
  );

  const candidates: CandidateAccount[] = [];
  let tokenCount = 0;
  for (const account of result.rows) {
    const workspaces = (Array.isArray(account.workspace_tokens) ? account.workspace_tokens : []).filter(validWorkspace);
    if (workspaces.length === 0) {
      continue;
    }

    candidates.push({
      account_id: Number(account.id),
      email: String(account.email || ""),
      card_type: normalizeCardType(account.card_type),
      workspaces,
    });
    tokenCount += workspaces.length;

    if (tokenCount >= requiredTokenCount) {
      break;
    }
  }

  return candidates;
}

async function recordUpload(
  candidate: CandidateAccount,
  workspace: WorkspaceToken,
  setting: SiteGroupSetting,
  status: "success" | "failed",
  result: { remote_account_id?: number; remote_account_name?: string; error_message?: string }
) {
  const pool = getMailboxDbPool();
  await pool.query(
    `
    INSERT INTO chatgpt_sub2api_uploads (
      account_id, workspace_id, workspace_name, site_id, group_id,
      remote_account_id, remote_account_name, status, error_message
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    ON CONFLICT (account_id, workspace_id, site_id, group_id) DO UPDATE
    SET
      remote_account_id = EXCLUDED.remote_account_id,
      remote_account_name = EXCLUDED.remote_account_name,
      status = EXCLUDED.status,
      error_message = EXCLUDED.error_message,
      uploaded_at = NOW(),
      updated_at = NOW()
    `,
    [
      candidate.account_id,
      String(workspace.workspace_id || ""),
      String(workspace.workspace_name || ""),
      setting.site_id,
      setting.group_id,
      result.remote_account_id || null,
      result.remote_account_name || "",
      status,
      result.error_message || null,
    ]
  );
}

async function uploadWorkspace(
  candidate: CandidateAccount,
  workspace: WorkspaceToken,
  setting: SiteGroupSetting,
  index: number,
  batchDate: string
) {
  const payload = buildSub2ApiPayload(candidate, workspace, setting.group_id, index, batchDate);
  const response = await fetch(`${setting.api_url.replace(/\/+$/, "")}/api/v1/admin/accounts`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "x-api-key": setting.api_key,
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      data?.message || data?.msg || data?.error || `Sub2API upload failed: HTTP ${response.status}`
    );
  }

  const remote = data?.data || data?.account || data;
  return {
    remote_account_id: Number(remote?.id) || undefined,
    remote_account_name: String(remote?.name || payload.name),
  };
}

export async function POST(request: Request) {
  try {
    await ensureSub2ApiSitesTable();
    const body = await request.json().catch(() => ({}));
    const siteId = body.site_id ? Number.parseInt(String(body.site_id), 10) : undefined;
    const groupId = body.group_id ? Number.parseInt(String(body.group_id), 10) : undefined;
    const dryRun = body.dry_run === true;
    const settings = await loadSettings(siteId, groupId);
    const pool = getMailboxDbPool();
    const results = [];
    const reservedAccountIds = new Set<number>();
    const batchDate = formatBatchDate();

    for (const setting of settings) {
      const groups = await fetchRemoteGroups(setting);
      const group = groups.find((item) => Number(item.id) === Number(setting.group_id));
      if (!group) {
        results.push({ ...setting, ok: false, error: "远端分组不存在" });
        continue;
      }

      const currentAvailable = availableCount(group);
      const deficit = Math.max(Number(setting.threshold_available) - currentAvailable, 0);
      await pool.query(
        `
        UPDATE sub2api_group_settings
        SET
          last_account_count = $1,
          last_available_count = $2,
          last_rate_limited_count = $3,
          last_checked_at = NOW(),
          updated_at = NOW()
        WHERE site_id = $4 AND group_id = $5
        `,
        [
          Number(group.account_count || 0),
          currentAvailable,
          Number(group.rate_limited_account_count || 0),
          setting.site_id,
          setting.group_id,
        ]
      );

      if (deficit === 0) {
        results.push({ ...setting, ok: true, available: currentAvailable, threshold: setting.threshold_available, uploaded: 0 });
        continue;
      }

      const candidates = await loadCandidateAccounts(reservedAccountIds, deficit);
      for (const candidate of candidates) {
        reservedAccountIds.add(candidate.account_id);
      }

      let uploaded = 0;
      let uploadIndex = 1;
      const failures = [];
      for (const candidate of candidates) {
        if (dryRun) {
          uploaded += candidate.workspaces.length;
          continue;
        }

        for (const workspace of candidate.workspaces) {
          try {
            const remote = await uploadWorkspace(candidate, workspace, setting, uploadIndex, batchDate);
            await recordUpload(candidate, workspace, setting, "success", remote);
            uploaded += 1;
          } catch (error) {
            const message = error instanceof Error ? error.message : "上传失败";
            await recordUpload(candidate, workspace, setting, "failed", { error_message: message });
            failures.push({
              account_id: candidate.account_id,
              workspace_id: workspace.workspace_id,
              error: message,
            });
          } finally {
            uploadIndex += 1;
          }
        }
      }

      results.push({
        ...setting,
        ok: failures.length === 0,
        available: currentAvailable,
        threshold: setting.threshold_available,
        deficit,
        candidate_account_count: candidates.length,
        candidate_token_count: candidates.reduce((total, candidate) => total + candidate.workspaces.length, 0),
        uploaded,
        failures,
      });
    }

    return NextResponse.json({ success: true, dry_run: dryRun, results });
  } catch (error) {
    console.error("Failed to run sub2api monitor:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to run sub2api monitor" },
      { status: 500 }
    );
  }
}
