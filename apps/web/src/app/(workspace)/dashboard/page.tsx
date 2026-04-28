import {
  Button,
  Card,
  Divider,
  Empty,
  Flex,
  Progress,
  Space,
  Statistic,
  Tag,
} from "antd";
import {
  ApiOutlined,
  ArrowRightOutlined,
  CheckCircleOutlined,
  CloudServerOutlined,
  InboxOutlined,
  LinkOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import Paragraph from "antd/es/typography/Paragraph";
import Text from "antd/es/typography/Text";
import { getMailboxDbPool } from "@/lib/mailboxes/db";
import { ensureSub2ApiSitesTable } from "@/lib/sub2api-sites/repository";

export const dynamic = "force-dynamic";

type CountRow = Record<string, string | number | null>;

type RecentTask = {
  task_id: string;
  task_type: string;
  status: string;
  created_at: string | Date;
  completed_at?: string | Date | null;
};

type DashboardSummary = {
  chatgpt: {
    total: number;
    active: number;
    abnormal: number;
    exported: number;
    withTokens: number;
    validWorkspaceTokens: number;
    plus: number;
    team: number;
    plusTeam: number;
    unrefreshed: number;
    shortCard: number;
    longCard: number;
    paymentLinks: number;
  };
  sub2api: {
    sites: number;
    activeSites: number;
    monitoredGroups: number;
    riskyGroups: number;
    uploadedAccounts: number;
    failedUploads: number;
  };
  moemail: {
    providers: number;
    activeProviders: number;
    healthyProviders: number;
    defaultProvider: number;
    mailboxesCreated: number;
    messages: number;
    messagesToday: number;
    blockedDomains: number;
  };
  proxies: {
    total: number;
    active: number;
    checked: number;
    failed: number;
  };
  tasks: {
    pending: number;
    running: number;
    completed: number;
    failed: number;
    recent: RecentTask[];
  };
  warnings: string[];
};

const cardStyle = {
  background: "var(--surface)",
  border: "1px solid var(--border-color)",
  boxShadow: "var(--shadow-soft)",
};

function toNumber(value: unknown) {
  return Number(value || 0);
}

async function safeQuery<T extends CountRow>(
  sql: string,
  fallback: T[],
  params: unknown[] = []
): Promise<T[]> {
  try {
    const pool = getMailboxDbPool();
    const result = await pool.query(sql, params);
    return result.rows as T[];
  } catch (error) {
    console.warn("Dashboard query skipped:", error);
    return fallback;
  }
}

async function ensureChatgptCardTypeColumn() {
  const pool = getMailboxDbPool();
  await pool.query("ALTER TABLE chatgpt_accounts ADD COLUMN IF NOT EXISTS card_type TEXT NOT NULL DEFAULT '短效'");
  await pool.query("UPDATE chatgpt_accounts SET card_type = '短效' WHERE card_type IS NULL OR card_type NOT IN ('短效', '长效')");
}

function percent(part: number, total: number) {
  if (!total) {
    return 0;
  }
  return Math.round((part / total) * 100);
}

function formatDateTime(value?: string | Date | null) {
  if (!value) {
    return "-";
  }
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function taskStatusTag(status: string) {
  const config: Record<string, { color: string; text: string }> = {
    pending: { color: "default", text: "等待中" },
    running: { color: "processing", text: "运行中" },
    completed: { color: "success", text: "已完成" },
    failed: { color: "error", text: "失败" },
  };
  const item = config[status] || { color: "default", text: status || "未知" };
  return <Tag color={item.color}>{item.text}</Tag>;
}

async function loadDashboardSummary(): Promise<DashboardSummary> {
  try {
    await Promise.all([
      ensureSub2ApiSitesTable(),
      ensureChatgptCardTypeColumn(),
    ]);
  } catch (error) {
    console.warn("Dashboard could not ensure optional tables:", error);
  }

  const [
    chatgptRows,
    tokenRows,
    sub2apiRows,
    moemailRows,
    proxyRows,
    taskRows,
    recentTaskRows,
  ] = await Promise.all([
    safeQuery(
      `
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'active') AS active,
        COUNT(*) FILTER (WHERE status <> 'active') AS abnormal,
        COUNT(*) FILTER (WHERE exported = true) AS exported,
        COUNT(*) FILTER (
          WHERE workspace_tokens IS NOT NULL
            AND jsonb_typeof(workspace_tokens) = 'array'
            AND jsonb_array_length(workspace_tokens) > 0
        ) AS with_tokens,
        COUNT(*) FILTER (WHERE subscription_type = 'plus') AS plus,
        COUNT(*) FILTER (WHERE subscription_type = 'team') AS team,
        COUNT(*) FILTER (WHERE subscription_type = 'plus_team') AS plus_team,
        COUNT(*) FILTER (WHERE subscription_type IS NULL OR subscription_type = '') AS unrefreshed,
        COUNT(*) FILTER (WHERE card_type IS NULL OR card_type = '短效') AS short_card,
        COUNT(*) FILTER (WHERE card_type = '长效') AS long_card,
        COUNT(*) FILTER (WHERE checkout_url IS NOT NULL OR team_checkout_url IS NOT NULL) AS payment_links
      FROM chatgpt_accounts
      WHERE deleted_at IS NULL
      `,
      [{
        total: 0,
        active: 0,
        abnormal: 0,
        exported: 0,
        with_tokens: 0,
        plus: 0,
        team: 0,
        plus_team: 0,
        unrefreshed: 0,
        short_card: 0,
        long_card: 0,
        payment_links: 0,
      }]
    ),
    safeQuery(
      `
      SELECT COUNT(*) AS valid_workspace_tokens
      FROM chatgpt_accounts a
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE
          WHEN jsonb_typeof(a.workspace_tokens) = 'array' THEN a.workspace_tokens
          ELSE '[]'::jsonb
        END
      ) AS workspace(item)
      WHERE a.deleted_at IS NULL
        AND COALESCE(workspace.item->>'workspace_id', '') NOT IN ('', 'default', 'global')
        AND COALESCE(workspace.item->>'refresh_token', '') <> ''
      `,
      [{ valid_workspace_tokens: 0 }]
    ),
    safeQuery(
      `
      SELECT
        (SELECT COUNT(*) FROM sub2api_sites WHERE deleted_at IS NULL) AS sites,
        (SELECT COUNT(*) FROM sub2api_sites WHERE deleted_at IS NULL AND status = 'active') AS active_sites,
        (SELECT COUNT(*) FROM sub2api_group_settings WHERE threshold_available > 0) AS monitored_groups,
        (
          SELECT COUNT(*)
          FROM sub2api_group_settings
          WHERE threshold_available > 0
            AND COALESCE(last_available_count, 0) < threshold_available
        ) AS risky_groups,
        (
          SELECT COUNT(DISTINCT account_id)
          FROM chatgpt_sub2api_uploads
          WHERE status = 'success'
        ) AS uploaded_accounts,
        (
          SELECT COUNT(*)
          FROM chatgpt_sub2api_uploads
          WHERE status = 'failed'
        ) AS failed_uploads
      `,
      [{
        sites: 0,
        active_sites: 0,
        monitored_groups: 0,
        risky_groups: 0,
        uploaded_accounts: 0,
        failed_uploads: 0,
      }]
    ),
    safeQuery(
      `
      SELECT
        (SELECT COUNT(*) FROM email_providers WHERE deleted_at IS NULL) AS providers,
        (SELECT COUNT(*) FROM email_providers WHERE deleted_at IS NULL AND status = 'active') AS active_providers,
        (
          SELECT COUNT(*)
          FROM email_providers
          WHERE deleted_at IS NULL
            AND health_check_status = 'healthy'
        ) AS healthy_providers,
        (
          SELECT COUNT(*)
          FROM email_providers
          WHERE deleted_at IS NULL
            AND provider_type = 'moemail'
            AND is_default = true
            AND status = 'active'
        ) AS default_provider,
        (
          SELECT COALESCE(SUM(total_mailboxes_created), 0)
          FROM email_providers
          WHERE deleted_at IS NULL
        ) AS mailboxes_created,
        0 AS messages,
        0 AS messages_today,
        (
          SELECT COUNT(*)
          FROM email_provider_domains
          WHERE status = 'blocked'
        ) AS blocked_domains
      `,
      [{
        providers: 0,
        active_providers: 0,
        healthy_providers: 0,
        default_provider: 0,
        mailboxes_created: 0,
        messages: 0,
        messages_today: 0,
        blocked_domains: 0,
      }]
    ),
    safeQuery(
      `
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE is_active = true) AS active,
        COUNT(*) FILTER (WHERE last_checked_at IS NOT NULL) AS checked,
        COUNT(*) FILTER (WHERE last_error IS NOT NULL AND last_error <> '') AS failed
      FROM proxies
      WHERE deleted_at IS NULL
      `,
      [{ total: 0, active: 0, checked: 0, failed: 0 }]
    ),
    safeQuery(
      `
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending') AS pending,
        COUNT(*) FILTER (WHERE status = 'running') AS running,
        COUNT(*) FILTER (WHERE status = 'completed') AS completed,
        COUNT(*) FILTER (WHERE status = 'failed') AS failed
      FROM registration_tasks
      WHERE created_at >= NOW() - INTERVAL '7 days'
      `,
      [{ pending: 0, running: 0, completed: 0, failed: 0 }]
    ),
    safeQuery(
      `
      SELECT task_id, task_type, status, created_at, completed_at
      FROM registration_tasks
      ORDER BY created_at DESC
      LIMIT 6
      `,
      []
    ),
  ]);

  const chatgptRow = chatgptRows[0] || {};
  const sub2apiRow = sub2apiRows[0] || {};
  const moemailRow = moemailRows[0] || {};
  const proxyRow = proxyRows[0] || {};
  const taskRow = taskRows[0] || {};

  const summary: DashboardSummary = {
    chatgpt: {
      total: toNumber(chatgptRow.total),
      active: toNumber(chatgptRow.active),
      abnormal: toNumber(chatgptRow.abnormal),
      exported: toNumber(chatgptRow.exported),
      withTokens: toNumber(chatgptRow.with_tokens),
      validWorkspaceTokens: toNumber(tokenRows[0]?.valid_workspace_tokens),
      plus: toNumber(chatgptRow.plus),
      team: toNumber(chatgptRow.team),
      plusTeam: toNumber(chatgptRow.plus_team),
      unrefreshed: toNumber(chatgptRow.unrefreshed),
      shortCard: toNumber(chatgptRow.short_card),
      longCard: toNumber(chatgptRow.long_card),
      paymentLinks: toNumber(chatgptRow.payment_links),
    },
    sub2api: {
      sites: toNumber(sub2apiRow.sites),
      activeSites: toNumber(sub2apiRow.active_sites),
      monitoredGroups: toNumber(sub2apiRow.monitored_groups),
      riskyGroups: toNumber(sub2apiRow.risky_groups),
      uploadedAccounts: toNumber(sub2apiRow.uploaded_accounts),
      failedUploads: toNumber(sub2apiRow.failed_uploads),
    },
    moemail: {
      providers: toNumber(moemailRow.providers),
      activeProviders: toNumber(moemailRow.active_providers),
      healthyProviders: toNumber(moemailRow.healthy_providers),
      defaultProvider: toNumber(moemailRow.default_provider),
      mailboxesCreated: toNumber(moemailRow.mailboxes_created),
      messages: toNumber(moemailRow.messages),
      messagesToday: toNumber(moemailRow.messages_today),
      blockedDomains: toNumber(moemailRow.blocked_domains),
    },
    proxies: {
      total: toNumber(proxyRow.total),
      active: toNumber(proxyRow.active),
      checked: toNumber(proxyRow.checked),
      failed: toNumber(proxyRow.failed),
    },
    tasks: {
      pending: toNumber(taskRow.pending),
      running: toNumber(taskRow.running),
      completed: toNumber(taskRow.completed),
      failed: toNumber(taskRow.failed),
      recent: recentTaskRows as RecentTask[],
    },
    warnings: [],
  };

  if (summary.moemail.defaultProvider === 0) {
    summary.warnings.push("未配置可用的默认 MoeMail 邮箱服务");
  }
  if (summary.sub2api.sites > 0 && summary.sub2api.monitoredGroups === 0) {
    summary.warnings.push("Sub2API 站点已配置，但还没有设置监控分组阈值");
  }
  if (summary.sub2api.riskyGroups > 0) {
    summary.warnings.push(`${summary.sub2api.riskyGroups} 个 Sub2API 分组低于可用账号阈值`);
  }
  if (summary.proxies.total > 0 && summary.proxies.active === 0) {
    summary.warnings.push("代理列表存在，但当前没有启用的代理");
  }
  if (summary.tasks.failed > 0) {
    summary.warnings.push(`最近 7 天有 ${summary.tasks.failed} 个任务失败，需要复查日志`);
  }
  if (summary.chatgpt.total > 0 && summary.chatgpt.withTokens === 0) {
    summary.warnings.push("ChatGPT 账号还没有可用 workspace tokens");
  }

  return summary;
}

function StatCard({
  title,
  value,
  suffix,
  icon,
  color,
  description,
}: {
  title: string;
  value: number;
  suffix?: string;
  icon: React.ReactNode;
  color: string;
  description: string;
}) {
  return (
    <Card className="arm-responsive-card" variant="borderless" style={cardStyle}>
      <Flex justify="space-between" align="flex-start" gap={12}>
        <Statistic title={title} value={value} suffix={suffix} />
        <Flex
          align="center"
          justify="center"
          style={{
            width: 42,
            height: 42,
            borderRadius: 14,
            background: color,
            color: "#fff",
            fontSize: 20,
            flexShrink: 0,
          }}
        >
          {icon}
        </Flex>
      </Flex>
      <Paragraph type="secondary" style={{ margin: "10px 0 0", fontSize: 13 }}>
        {description}
      </Paragraph>
    </Card>
  );
}

function ModuleCard({
  title,
  icon,
  href,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Card
      className="arm-responsive-card arm-module-card"
      variant="borderless"
      style={{ ...cardStyle, height: "100%" }}
      title={
        <Space size={8}>
          {icon}
          <span>{title}</span>
        </Space>
      }
      extra={
        <Button type="link" href={href} style={{ paddingInlineEnd: 0 }}>
          进入 <ArrowRightOutlined />
        </Button>
      }
    >
      {children}
    </Card>
  );
}

function MetricLine({
  label,
  value,
  total,
  color = "#465fff",
}: {
  label: string;
  value: number;
  total?: number;
  color?: string;
}) {
  const computedTotal = total ?? value;
  return (
    <Space direction="vertical" size={4} style={{ width: "100%" }}>
      <Flex justify="space-between" gap={12}>
        <Text type="secondary">{label}</Text>
        <Text strong>
          {value}
          {total !== undefined ? ` / ${total}` : ""}
        </Text>
      </Flex>
      {total !== undefined ? (
        <Progress
          percent={percent(value, computedTotal)}
          size="small"
          showInfo={false}
          strokeColor={color}
        />
      ) : null}
    </Space>
  );
}

export default async function DashboardPage() {
  const summary = await loadDashboardSummary();

  return (
    <Space direction="vertical" size={20} style={{ width: "100%" }}>
      <div className="arm-dashboard-grid arm-dashboard-stat-grid">
        <StatCard
          title="ChatGPT 账号"
          value={summary.chatgpt.total}
          icon={<RobotOutlined />}
          color="#465fff"
          description={`活跃 ${summary.chatgpt.active} 个，异常/待处理 ${summary.chatgpt.abnormal} 个`}
        />
        <StatCard
          title="有效 Tokens"
          value={summary.chatgpt.validWorkspaceTokens}
          icon={<ThunderboltOutlined />}
          color="#13c2c2"
          description={`${summary.chatgpt.withTokens} 个账号已提取 workspace tokens`}
        />
        <StatCard
          title="Sub2API 上传"
          value={summary.sub2api.uploadedAccounts}
          icon={<ApiOutlined />}
          color="#52c41a"
          description={`${summary.sub2api.activeSites}/${summary.sub2api.sites} 个站点启用`}
        />
        <StatCard
          title="MoeMail 邮箱"
          value={summary.moemail.mailboxesCreated}
          icon={<InboxOutlined />}
          color="#faad14"
          description={`今日收到 ${summary.moemail.messagesToday} 封，本地记录 ${summary.moemail.messages} 封`}
        />
      </div>

      <div className="arm-dashboard-grid arm-dashboard-module-grid">
        <ModuleCard title="ChatGPT 账号池" icon={<RobotOutlined />} href="/resources/chatgpt">
          <Space direction="vertical" size={14} style={{ width: "100%" }}>
            <MetricLine label="账号活跃率" value={summary.chatgpt.active} total={summary.chatgpt.total} />
            <MetricLine label="Token 覆盖率" value={summary.chatgpt.withTokens} total={summary.chatgpt.total} color="#13c2c2" />
            <Flex wrap="wrap" gap={8}>
              <Tag color="gold">Plus {summary.chatgpt.plus}</Tag>
              <Tag color="green">Team {summary.chatgpt.team}</Tag>
              <Tag color="purple">Plus+Team {summary.chatgpt.plusTeam}</Tag>
              <Tag>未刷新 {summary.chatgpt.unrefreshed}</Tag>
              <Tag color="blue">短效 {summary.chatgpt.shortCard}</Tag>
              <Tag color="cyan">长效 {summary.chatgpt.longCard}</Tag>
            </Flex>
            <Flex wrap="wrap" gap={8}>
              <Tag icon={<LinkOutlined />} color="processing">
                支付链接 {summary.chatgpt.paymentLinks}
              </Tag>
              <Tag color="success">已导出 {summary.chatgpt.exported}</Tag>
            </Flex>
          </Space>
        </ModuleCard>

        <ModuleCard title="Sub2API 补量状态" icon={<CloudServerOutlined />} href="/sites/sub2api">
          <Space direction="vertical" size={14} style={{ width: "100%" }}>
            <MetricLine label="启用站点" value={summary.sub2api.activeSites} total={summary.sub2api.sites} color="#52c41a" />
            <MetricLine label="监控分组" value={summary.sub2api.monitoredGroups} />
            <Flex wrap="wrap" gap={8}>
              <Tag color={summary.sub2api.riskyGroups > 0 ? "error" : "success"}>
                阈值不足 {summary.sub2api.riskyGroups}
              </Tag>
              <Tag color={summary.sub2api.failedUploads > 0 ? "warning" : "default"}>
                失败上传 {summary.sub2api.failedUploads}
              </Tag>
              <Tag color="success">已绑定账号 {summary.sub2api.uploadedAccounts}</Tag>
            </Flex>
            <Text type="secondary">
              监控分组会按阈值自动挑选未上传过的账号补进指定站点分组。
            </Text>
          </Space>
        </ModuleCard>

        <ModuleCard title="邮箱与代理配置" icon={<SafetyCertificateOutlined />} href="/settings/email-providers">
          <Space direction="vertical" size={14} style={{ width: "100%" }}>
            <MetricLine label="邮箱服务启用" value={summary.moemail.activeProviders} total={summary.moemail.providers} color="#faad14" />
            <MetricLine label="代理启用" value={summary.proxies.active} total={summary.proxies.total} color="#722ed1" />
            <Flex wrap="wrap" gap={8}>
              <Tag color={summary.moemail.defaultProvider > 0 ? "success" : "warning"}>
                默认 MoeMail {summary.moemail.defaultProvider > 0 ? "已配置" : "未配置"}
              </Tag>
              <Tag color={summary.moemail.blockedDomains > 0 ? "error" : "default"}>
                被封域名 {summary.moemail.blockedDomains}
              </Tag>
              <Tag color={summary.proxies.failed > 0 ? "warning" : "success"}>
                代理异常 {summary.proxies.failed}
              </Tag>
            </Flex>
            <Space wrap>
              <Button size="small" href="/settings/email-providers">
                邮箱服务配置
              </Button>
              <Button size="small" href="/settings/proxies">
                代理配置
              </Button>
            </Space>
          </Space>
        </ModuleCard>
      </div>

      <div className="arm-dashboard-grid arm-dashboard-task-grid">
        <Card
          className="arm-responsive-card"
          variant="borderless"
          style={cardStyle}
          title={
            <Space>
              <ThunderboltOutlined />
              最近任务
            </Space>
          }
        >
          {summary.tasks.recent.length > 0 ? (
            <Space direction="vertical" size={0} split={<Divider style={{ margin: 0 }} />} style={{ width: "100%" }}>
              {summary.tasks.recent.map((task) => (
                <Flex
                  className="arm-dashboard-recent-task"
                  key={task.task_id}
                  justify="space-between"
                  align="center"
                  gap={16}
                  wrap="wrap"
                >
                  <Space className="arm-dashboard-recent-task-main" direction="vertical" size={2}>
                    <Text strong>{task.task_type || "未知任务"}</Text>
                    <Text className="arm-ellipsis" type="secondary" style={{ fontSize: 12 }}>
                      {task.task_id}
                    </Text>
                  </Space>
                  <Space className="arm-dashboard-recent-task-meta" size={12}>
                    {taskStatusTag(task.status)}
                    <Text type="secondary">{formatDateTime(task.created_at)}</Text>
                  </Space>
                </Flex>
              ))}
            </Space>
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无任务记录" />
          )}
        </Card>

        <Card
          className="arm-responsive-card"
          variant="borderless"
          style={cardStyle}
          title={
            <Space>
              <CheckCircleOutlined />
              7 天任务状态
            </Space>
          }
        >
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            <Flex justify="space-between">
              <Text>运行中</Text>
              <Tag color={summary.tasks.running > 0 ? "processing" : "default"}>{summary.tasks.running}</Tag>
            </Flex>
            <Flex justify="space-between">
              <Text>等待中</Text>
              <Tag>{summary.tasks.pending}</Tag>
            </Flex>
            <Flex justify="space-between">
              <Text>已完成</Text>
              <Tag color="success">{summary.tasks.completed}</Tag>
            </Flex>
            <Flex justify="space-between">
              <Text>失败</Text>
              <Tag color={summary.tasks.failed > 0 ? "error" : "default"}>{summary.tasks.failed}</Tag>
            </Flex>
            <Divider style={{ margin: "4px 0" }} />
            <Flex align="center" gap={8}>
              <CheckCircleOutlined style={{ color: "#52c41a" }} />
              <Text type="secondary">状态汇总来自最近 7 天任务记录。</Text>
            </Flex>
          </Space>
        </Card>
      </div>
    </Space>
  );
}
