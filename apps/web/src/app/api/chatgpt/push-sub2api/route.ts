import { NextResponse } from "next/server";
import { getMailboxDbPool } from "@/lib/mailboxes/db";
import {
  ensureSub2ApiSitesTable,
  getSub2ApiSiteSecretById,
} from "@/lib/sub2api-sites/repository";

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

type Sub2ApiSiteSetting = {
  site_id: number;
  site_name: string;
  api_url: string;
  api_key: string;
  group_id: number;
};

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

function buildSub2ApiPayload(
  candidate: CandidateAccount,
  workspace: WorkspaceToken,
  setting: Sub2ApiSiteSetting,
  sequence: number,
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
    name: `${batchDate}-${candidate.card_type} #${sequence}`,
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
    group_ids: [setting.group_id],
    concurrency: 10,
    priority: 1,
    rate_multiplier: 1,
    auto_pause_on_expired: true,
    proxy_id: null,
  };
}

async function loadCandidateAccounts(accountIds: number[]): Promise<CandidateAccount[]> {
  const pool = getMailboxDbPool();
  await ensureChatGPTCardTypeColumn();
  const result = await pool.query(
    `
    SELECT id, email, workspace_tokens, card_type
    FROM chatgpt_accounts
    WHERE id = ANY($1::bigint[])
      AND deleted_at IS NULL
    ORDER BY array_position($1::bigint[], id)
    `,
    [accountIds]
  );

  return result.rows.map((account) => ({
    account_id: Number(account.id),
    email: String(account.email || ""),
    card_type: normalizeCardType(account.card_type),
    workspaces: (Array.isArray(account.workspace_tokens) ? account.workspace_tokens : []).filter(validWorkspace),
  }));
}

async function recordUpload(
  candidate: CandidateAccount,
  workspace: WorkspaceToken,
  setting: Sub2ApiSiteSetting,
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
  setting: Sub2ApiSiteSetting,
  sequence: number,
  batchDate: string
) {
  const payload = buildSub2ApiPayload(candidate, workspace, setting, sequence, batchDate);
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
    const accountIds: number[] = Array.isArray(body.account_ids)
      ? Array.from(
          new Set<number>(
            body.account_ids
              .map((value: unknown) => Number.parseInt(String(value), 10))
              .filter((value: number): value is number => Number.isFinite(value) && value > 0)
          )
        )
      : [];
    const siteId = Number.parseInt(String(body.site_id || ""), 10);
    const groupId = Number.parseInt(String(body.group_id || ""), 10);

    if (accountIds.length === 0) {
      return NextResponse.json({ error: "请选择要推送的账号" }, { status: 400 });
    }
    if (!Number.isFinite(siteId) || siteId <= 0) {
      return NextResponse.json({ error: "请选择 Sub2API 站点" }, { status: 400 });
    }
    if (!Number.isFinite(groupId) || groupId <= 0) {
      return NextResponse.json({ error: "请选择 Sub2API 分组" }, { status: 400 });
    }

    const site = await getSub2ApiSiteSecretById(siteId);
    if (!site) {
      return NextResponse.json({ error: "Sub2API 站点不存在" }, { status: 404 });
    }

    const setting: Sub2ApiSiteSetting = {
      site_id: Number(site.id),
      site_name: site.name,
      api_url: site.api_url,
      api_key: site.api_key,
      group_id: groupId,
    };
    const candidates = await loadCandidateAccounts(accountIds);
    const batchDate = formatBatchDate();
    const failures: Array<{ account_id: number; workspace_id?: string; error: string }> = [];
    const skipped = candidates.filter((candidate) => candidate.workspaces.length === 0).length;
    let uploaded = 0;
    let sequence = 1;

    for (const candidate of candidates) {
      for (const workspace of candidate.workspaces) {
        try {
          const remote = await uploadWorkspace(candidate, workspace, setting, sequence, batchDate);
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
          sequence += 1;
        }
      }
    }

    return NextResponse.json({
      success: failures.length === 0,
      site_id: setting.site_id,
      group_id: setting.group_id,
      account_count: candidates.length,
      skipped_account_count: skipped,
      uploaded,
      failed: failures.length,
      failures,
    });
  } catch (error) {
    console.error("Failed to push selected accounts to sub2api:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "推送失败" },
      { status: 500 }
    );
  }
}
