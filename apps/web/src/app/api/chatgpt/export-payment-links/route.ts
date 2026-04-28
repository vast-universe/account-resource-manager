import { NextResponse } from "next/server";
import { getMailboxDbPool } from "@/lib/mailboxes/db";
import JSZip from "jszip";

export async function POST(request: Request) {
  try {
    let selectedIds: number[] = [];
    try {
      const body = await request.json();
      selectedIds = Array.isArray(body?.account_ids)
        ? Array.from(
            new Set(
              body.account_ids
                .map((value: unknown) => Number(value))
                .filter((value: number) => Number.isFinite(value))
            )
          )
        : [];
    } catch {
      selectedIds = [];
    }

    const pool = getMailboxDbPool();
    const hasSelection = selectedIds.length > 0;

    // 未选择账号时导出所有未导出链接；选择账号时按选择范围导出，忽略已导出状态。
    const result = await pool.query(
      `
      SELECT
        id, email, checkout_url, team_checkout_url
      FROM chatgpt_accounts
      WHERE deleted_at IS NULL
        ${hasSelection ? "AND id = ANY($1)" : "AND exported = FALSE"}
        AND (checkout_url IS NOT NULL OR team_checkout_url IS NOT NULL)
      ORDER BY created_at DESC
      `,
      hasSelection ? [selectedIds] : []
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: hasSelection ? "选中的账号没有支付链接" : "没有未导出的支付链接" },
        { status: 404 }
      );
    }

    // 生成 Plus / Team 两个文件内容，每行一个链接
    const plusLinks: string[] = [];
    const teamLinks: string[] = [];
    const accountIds: number[] = [];

    result.rows.forEach((row) => {
      let hasLink = false;

      if (row.checkout_url) {
        plusLinks.push(row.checkout_url);
        hasLink = true;
      }

      if (row.team_checkout_url) {
        teamLinks.push(row.team_checkout_url);
        hasLink = true;
      }

      if (hasLink) {
        accountIds.push(row.id);
      }
    });

    const plusContent = plusLinks.join("\n");
    const teamContent = teamLinks.join("\n");

    // 生成文件名（日期-时间格式）
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const dateTime = `${year}${month}${day}-${hours}${minutes}${seconds}`;
    const plusFilename = `${dateTime}-plus.txt`;
    const teamFilename = `${dateTime}-team.txt`;

    // 创建 ZIP 压缩包
    const zip = new JSZip();
    if (plusContent) {
      zip.file(plusFilename, plusContent);
    }
    if (teamContent) {
      zip.file(teamFilename, teamContent);
    }

    // 生成 ZIP 文件
    const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });

    // 标记为已导出
    if (accountIds.length > 0) {
      await pool.query(
        `
        UPDATE chatgpt_accounts
        SET exported = TRUE, exported_at = NOW()
        WHERE id = ANY($1)
        `,
        [accountIds]
      );
    }

    // 返回 ZIP 文件
    return new NextResponse(new Uint8Array(zipBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename=payment-links-${dateTime}.zip`,
      },
    });
  } catch (error) {
    console.error("Failed to export payment links:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to export" },
      { status: 500 }
    );
  }
}
