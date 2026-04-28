"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  Card,
  Button,
  Space,
  Tag,
  Input,
  InputNumber,
  Flex,
  Empty,
  Spin,
  Table,
  Tooltip,
  Modal,
  Form,
  Select,
  Dropdown,
  App,
  Alert,
  Grid,
  Progress,
  Pagination,
  Checkbox,
  type MenuProps,
} from "antd";
import {
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ClockCircleOutlined,
  WarningOutlined,
  DollarOutlined,
  ThunderboltOutlined,
  ExportOutlined,
  DeleteOutlined,
  CopyOutlined,
  DownOutlined,
  UploadOutlined,
  MoreOutlined,
} from "@ant-design/icons";
import Text from "antd/es/typography/Text";
import type { ColumnsType } from "antd/es/table";

interface ChatGPTAccount {
  id: number;
  public_id: string;
  email: string;
  email_service_id?: string;
  status: string;
  health_status: string;
  last_checked_at?: string;
  access_token_expires_at?: string;
  registration_source: string;
  checkout_url?: string;
  team_checkout_url?: string;
  exported: boolean;
  exported_at?: string;
  subscription_type?: string;
  card_type?: "短效" | "长效";
  password?: string;
  region?: string;
  workspace_tokens?: WorkspaceToken[];
  team_workspace_id?: string;
  team_member_count?: number;
  team_members_refreshed_at?: string;
  sub2api_uploads?: Sub2ApiUploadBinding[];
  created_at: string;
  updated_at: string;
}

interface Sub2ApiUploadBinding {
  site_id: number;
  site_name?: string;
  group_id: number;
  group_name?: string;
  workspace_id: string;
  workspace_name?: string;
  status: "success" | "failed";
  uploaded_at?: string;
}

interface WorkspaceToken {
  workspace_id?: string;
  workspace_name?: string;
  kind?: string;
  plan_type?: string;
  user_id?: string;
  matched?: boolean | string;
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  expires_at?: number;
  expires_in?: number;
}

interface TeamMember {
  id?: string;
  account_user_id?: string;
  email?: string;
  name?: string;
  role?: string;
  seat_type?: string;
  status?: string;
  created_time?: string;
}

interface TeamMembersResult {
  account_id: number;
  email: string;
  team_workspace_id: string;
  workspace?: {
    workspace_id: string;
    workspace_name?: string;
    plan_type?: string;
    status?: number;
    ok?: boolean;
    users?: TeamMember[];
    raw?: {
      total?: number;
      limit?: number;
      offset?: number;
    };
    error?: string;
  };
}

interface PaymentTaskStatus {
  task_id: string;
  status: string;
  logs?: string[];
  progress?: string;
  error_message?: string;
}

interface PaymentRegistrationFormValues {
  count?: number;
  concurrency?: number;
}

interface BatchRefreshFormValues {
  concurrency?: number;
}

interface PushSub2ApiFormValues {
  site_id?: number;
  group_id?: number;
}

interface Sub2ApiSiteOption {
  id: number;
  name: string;
  api_url: string;
  status: "active" | "inactive";
}

interface Sub2ApiGroupOption {
  id: number;
  name?: string;
  account_count?: number;
  active_account_count?: number;
  rate_limited_account_count?: number;
  threshold_available?: number;
}

export default function ChatGPTAccountsPage() {
  const { message } = App.useApp();
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;
  const [loading, setLoading] = useState(false);
  const [accounts, setAccounts] = useState<ChatGPTAccount[]>([]);
  const [searchValue, setSearchValue] = useState("");
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [paymentModalVisible, setPaymentModalVisible] = useState(false);
  const [batchRefreshModalVisible, setBatchRefreshModalVisible] = useState(false);
  const [pushSub2apiModalVisible, setPushSub2apiModalVisible] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [organizing, setOrganizing] = useState(false);
  const [form] = Form.useForm();
  const [batchRefreshForm] = Form.useForm<BatchRefreshFormValues>();
  const [pushSub2apiForm] = Form.useForm<PushSub2ApiFormValues>();
  const [taskLogsVisible, setTaskLogsVisible] = useState(false);
  const [taskStatuses, setTaskStatuses] = useState<Record<string, PaymentTaskStatus>>({});
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const taskLogsEndRef = useRef<HTMLDivElement>(null);
  const pollingTaskIdsRef = useRef<Set<string>>(new Set());
  const pollingTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [exporting, setExporting] = useState(false);
  const [exportingSub2api, setExportingSub2api] = useState(false);
  const [pushingSub2api, setPushingSub2api] = useState(false);
  const [loadingSub2apiSites, setLoadingSub2apiSites] = useState(false);
  const [loadingSub2apiGroups, setLoadingSub2apiGroups] = useState(false);
  const [sub2apiSites, setSub2apiSites] = useState<Sub2ApiSiteOption[]>([]);
  const [sub2apiGroups, setSub2apiGroups] = useState<Sub2ApiGroupOption[]>([]);
  const [refreshingAccountIds, setRefreshingAccountIds] = useState<Set<number>>(new Set());
  const [batchRefreshing, setBatchRefreshing] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [pushSub2apiTargetIds, setPushSub2apiTargetIds] = useState<number[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [tokenModalAccount, setTokenModalAccount] = useState<ChatGPTAccount | null>(null);
  const [teamMembersModal, setTeamMembersModal] = useState<TeamMembersResult | null>(null);
  const [loadingTeamMemberIds, setLoadingTeamMemberIds] = useState<Set<number>>(new Set());
  const [inviteModalAccount, setInviteModalAccount] = useState<ChatGPTAccount | null>(null);
  const [inviteTargetIds, setInviteTargetIds] = useState<number[]>([]);
  const [inviting, setInviting] = useState(false);
  const selectedAccountIds = useMemo(
    () => selectedRowKeys.map(Number).filter(Number.isFinite),
    [selectedRowKeys]
  );
  const hasBulkSelection = selectedAccountIds.length > 1;
  const bulkActionLoading = organizing || batchRefreshing || exportingSub2api || pushingSub2api || deleting;

  const fetchAccounts = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        limit: String(pageSize),
        offset: String((currentPage - 1) * pageSize),
      });
      const keyword = searchValue.trim();
      if (keyword) {
        params.set("q", keyword);
      }

      const res = await fetch(`/api/chatgpt/accounts?${params.toString()}`);
      const data = await res.json();
      setAccounts(data.accounts || []);
      setTotal(data.total);
    } catch {
      message.error("加载失败");
    } finally {
      setLoading(false);
    }
  }, [currentPage, pageSize, searchValue, message]);

  const handleAutoOrganize = async () => {
    const selectedAccountIds = selectedRowKeys.map(Number).filter(Number.isFinite);
    if (selectedAccountIds.length < 2) {
      message.warning("请至少选择 2 个账号进行 Team 互拉");
      return;
    }

    Modal.confirm({
      title: "确认执行 Team 互拉？",
      content: (
        <div>
          <p>系统会按当前选择的账号优先每 5 个一组执行 Team 互拉。</p>
          <ul>
            <li>本次使用已选 {selectedAccountIds.length} 个账号</li>
            <li>只处理自己是 Team 且已记录母号 Team 空间的账号</li>
            <li>分组前会实时查询 Team 成员，满员过滤，半满排到最后</li>
            <li>半满 Team 会优先匹配已经在它成员里的账号，尽量保持同组</li>
            <li>已存在的关系会跳过，不重复邀请</li>
            <li>互拉完成后会批量刷新本组成组账号的 tokens</li>
            <li>最后剩 1 个账号不会参与互拉</li>
          </ul>
          <Alert
            message="注意"
            description="此操作可能需要较长时间，请耐心等待"
            type="warning"
            showIcon
            style={{ marginTop: 12 }}
          />
        </div>
      ),
      okText: "开始组织",
      cancelText: "取消",
      onOk: async () => {
        setOrganizing(true);
        try {
          const res = await fetch("/api/chatgpt/team-mutual-bind", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              account_ids: selectedAccountIds,
            }),
          });
          const data = await res.json();
          if (!res.ok) {
            throw new Error(data.error || "Team 互拉失败");
          }

          if (data.success) {
            const skippedText = data.skipped_existing_count ? `，已跳过 ${data.skipped_existing_count} 个已有关系` : "";
            const skippedFullText = data.skipped_full_count ? `，实时满员跳过 ${data.skipped_full_count} 个` : "";
            const filteredText = data.skipped_accounts?.length ? `，过滤 ${data.skipped_accounts.length} 个账号` : "";
            const failedText = data.failed_count ? `，失败 ${data.failed_count} 个` : "";
            const incompleteText = data.incomplete_team_count ? `，未满 Team ${data.incomplete_team_count} 个` : "";
            const ungroupedText = data.ungrouped_accounts?.length ? `，剩余 ${data.ungrouped_accounts.length} 个未成组` : "";
            const refreshText = data.refresh_results ? `，刷新 tokens ${data.refresh_success_count || 0}/${data.refresh_results.length}` : "";
            const content = `Team 互拉完成：执行 ${data.total_actions || 0} 个，成功 ${data.success_count || 0} 个${skippedText}${skippedFullText}${filteredText}${failedText}${incompleteText}${ungroupedText}${refreshText}`;
            if (data.failed_count || data.incomplete_team_count) {
              message.warning(content);
            } else {
              message.success(content);
            }
            fetchAccounts();
          } else {
            message.error(data.message || "Team 互拉失败");
          }
        } catch (error) {
          message.error(getErrorMessage(error, "Team 互拉失败"));
        } finally {
          setOrganizing(false);
        }
      },
    });
  };

  const getErrorMessage = (error: unknown, fallback: string) => {
    return error instanceof Error ? error.message : fallback;
  };

  const handlePaymentRegistration = async (values: PaymentRegistrationFormValues) => {
    setRegistering(true);
    try {
      const res = await fetch("/api/chatgpt/payment-registration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          count: values.count || 30,
          concurrency: values.concurrency || 5,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "创建任务失败");
      }

      message.success(`已创建 ${values.count || 30} 个支付注册任务`);
      setPaymentModalVisible(false);
      form.resetFields();

      // 轮询所有任务状态
      if (data.task_ids && data.task_ids.length > 0) {
        pollingTimeoutsRef.current.forEach(clearTimeout);
        pollingTimeoutsRef.current.length = 0;
        pollingTaskIdsRef.current.clear();
        setTaskStatuses(
          Object.fromEntries(
            data.task_ids.map((taskId: string) => [
              taskId,
              {
                task_id: taskId,
                status: "pending",
                logs: [],
                progress: "0/0",
              },
            ])
          )
        );
        setSelectedTaskId(data.task_ids[0]);
        setTaskLogsVisible(true);
        data.task_ids.forEach((taskId: string) => {
          pollTaskStatus(taskId);
        });
      }
    } catch (error) {
      message.error(getErrorMessage(error, "创建任务失败"));
    } finally {
      setRegistering(false);
    }
  };

  const pollTaskStatus = async (taskId: string) => {
    if (pollingTaskIdsRef.current.has(taskId)) {
      return;
    }
    pollingTaskIdsRef.current.add(taskId);

    const maxAttempts = 60;
    let attempts = 0;

    const poll = async () => {
      try {
        const res = await fetch(`/api/chatgpt/tasks/${taskId}`);
        const data = await res.json();

        setTaskStatuses(prev => ({
          ...prev,
          [taskId]: {
            task_id: taskId,
            status: data.status,
            logs: Array.isArray(data.logs) ? data.logs : [],
            progress: data.progress,
            error_message: data.error_message,
          },
        }));

        if (data.status === "completed") {
          pollingTaskIdsRef.current.delete(taskId);
          message.success(`支付注册成功: ${taskId.slice(0, 8)}`);
          fetchAccounts();
          return;
        } else if (data.status === "failed") {
          pollingTaskIdsRef.current.delete(taskId);
          message.error(`支付注册失败: ${data.error_message || "未知错误"}`);
          return;
        }

        attempts++;
        if (attempts < maxAttempts) {
          const timeout = setTimeout(poll, 5000);
          pollingTimeoutsRef.current.push(timeout);
        } else {
          pollingTaskIdsRef.current.delete(taskId);
          message.warning("任务超时，请手动刷新查看结果");
        }
      } catch (error) {
        pollingTaskIdsRef.current.delete(taskId);
        console.error("轮询任务状态失败:", error);
      }
    };

    poll();
  };

  useEffect(() => {
    const pollingTaskIds = pollingTaskIdsRef.current;
    const pollingTimeouts = pollingTimeoutsRef.current;

    return () => {
      pollingTimeouts.forEach(clearTimeout);
      pollingTimeouts.length = 0;
      pollingTaskIds.clear();
    };
  }, []);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  const selectedTask = selectedTaskId ? taskStatuses[selectedTaskId] : undefined;
  const selectedTaskLogs = useMemo(() => selectedTask?.logs || [], [selectedTask]);
  const taskSummary = useMemo(() => {
    const tasks = Object.values(taskStatuses);
    const total = tasks.length;
    const success = tasks.filter(task => task.status === "completed").length;
    const failed = tasks.filter(task => task.status === "failed").length;
    const finished = success + failed;
    const running = Math.max(total - finished, 0);

    return {
      total,
      success,
      failed,
      finished,
      running,
      percent: total ? Math.round((finished / total) * 100) : 0,
      successPercent: total ? Math.round((success / total) * 100) : 0,
    };
  }, [taskStatuses]);
  const taskOptions = useMemo(
    () => Object.keys(taskStatuses).map(taskId => {
      const task = taskStatuses[taskId];
      return {
        label: `${taskId.slice(0, 8)} · ${task.status || "pending"} · ${task.progress || "0/0"}`,
        value: taskId,
      };
    }),
    [taskStatuses]
  );

  useEffect(() => {
    // 当日志更新时，自动滚动到底部
    if (taskLogsVisible && taskLogsEndRef.current) {
      taskLogsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [selectedTaskLogs, taskLogsVisible]);

  const filteredAccounts = accounts;

  const getWorkspaceTokens = (account?: ChatGPTAccount | null): WorkspaceToken[] => {
    return Array.isArray(account?.workspace_tokens) ? account.workspace_tokens : [];
  };

  const getWorkspaceTokenStats = (account?: ChatGPTAccount | null) => {
    const tokens = getWorkspaceTokens(account);
    return tokens.reduce(
      (stats, token) => {
        const planType = (token.plan_type || "").toLowerCase();
        if (planType === "plus") {
          stats.plus += 1;
        }
        if (planType === "team") {
          stats.team += 1;
        }
        return stats;
      },
      { plus: 0, team: 0, total: tokens.length },
    );
  };

  const hasFreePersonalToken = (account?: ChatGPTAccount | null) => {
    return getWorkspaceTokens(account).some(token => (
      (token.kind || "").toLowerCase() === "personal" &&
      (token.plan_type || "").toLowerCase() === "free"
    ));
  };

  const shouldShowTokenRefresh = (account?: ChatGPTAccount | null) => {
    const stats = getWorkspaceTokenStats(account);
    return hasFreePersonalToken(account) || stats.total < 6;
  };

  const shouldShowInviteAction = (account?: ChatGPTAccount | null) => {
    const stats = getWorkspaceTokenStats(account);
    return !!account?.team_workspace_id && stats.total < 6;
  };

  const selectedRefreshableCount = accounts.filter(
    account => selectedRowKeys.includes(account.id) && shouldShowTokenRefresh(account)
  ).length;

  const hasSuccessfulSub2ApiUpload = (account?: ChatGPTAccount | null) => {
    return (account?.sub2api_uploads || []).some(item => item.status === "success");
  };

  const hasPaymentLink = (account?: ChatGPTAccount | null) => {
    return !!(account?.checkout_url || account?.team_checkout_url);
  };

  const selectAccountsBy = (predicate: (account: ChatGPTAccount) => boolean) => {
    setSelectedRowKeys(filteredAccounts.filter(predicate).map(account => account.id));
  };

  const selectionPresets = [
    {
      key: "current-page",
      text: "当前页全部",
      onSelect: () => selectAccountsBy(() => true),
    },
    {
      key: "active",
      text: "活跃账号",
      onSelect: () => selectAccountsBy(account => account.status === "active"),
    },
    {
      key: "abnormal",
      text: "异常账号",
      onSelect: () => selectAccountsBy(account => account.status !== "active"),
    },
    {
      key: "refreshable",
      text: "需要刷新 tokens",
      onSelect: () => selectAccountsBy(shouldShowTokenRefresh),
    },
    {
      key: "team-bindable",
      text: "可 Team 互拉",
      onSelect: () => selectAccountsBy(shouldShowInviteAction),
    },
    {
      key: "not-uploaded-sub2api",
      text: "未上传 Sub2API",
      onSelect: () => selectAccountsBy(account => !hasSuccessfulSub2ApiUpload(account)),
    },
    {
      key: "uploaded-sub2api",
      text: "已上传 Sub2API",
      onSelect: () => selectAccountsBy(hasSuccessfulSub2ApiUpload),
    },
    {
      key: "with-payment-links",
      text: "有支付链接",
      onSelect: () => selectAccountsBy(hasPaymentLink),
    },
    {
      key: "unrefreshed-subscription",
      text: "未识别订阅",
      onSelect: () => selectAccountsBy(account => !account.subscription_type),
    },
  ];

  const bulkActionItems: MenuProps["items"] = [
    {
      key: "team-organize",
      label: "Team 互拉",
      icon: <ThunderboltOutlined />,
      disabled: selectedAccountIds.length < 2,
    },
    {
      key: "refresh-selected",
      label: "刷新选中",
      icon: <ReloadOutlined />,
      disabled: selectedRefreshableCount === 0,
    },
    {
      key: "refresh-subscription-selected",
      label: "批量刷新订阅",
      icon: <ReloadOutlined />,
      disabled: selectedAccountIds.length === 0,
    },
    {
      key: "push-sub2api",
      label: "推送 Sub2API",
      icon: <UploadOutlined />,
      disabled: selectedAccountIds.length === 0,
    },
    {
      key: "export-sub2api",
      label: "导出 sub2api",
      icon: <ExportOutlined />,
      disabled: selectedAccountIds.length === 0,
    },
    {
      key: "batch-delete",
      label: "批量删除",
      icon: <DeleteOutlined />,
      danger: true,
      disabled: selectedAccountIds.length === 0,
    },
  ];

  const handleBulkActionClick = (key: string) => {
    if (key === "team-organize") {
      handleAutoOrganize();
    } else if (key === "refresh-selected") {
      openBatchRefreshModal();
    } else if (key === "refresh-subscription-selected") {
      handleBatchRefreshSubscriptions();
    } else if (key === "push-sub2api") {
      openPushSub2apiModal(selectedAccountIds);
    } else if (key === "export-sub2api") {
      handleExportSub2api();
    } else if (key === "batch-delete") {
      handleBatchDelete();
    }
  };

  const maskToken = (token?: string) => {
    if (!token) return "-";
    if (token.length <= 24) return token;
    return `${token.slice(0, 16)}...${token.slice(-8)}`;
  };

  const formatExpiry = (expiresAt?: number) => {
    if (!expiresAt) return "-";
    return new Date(expiresAt).toLocaleString();
  };

  const getSubscriptionTag = (subscriptionType?: string) => {
    const subscriptionMap: Record<string, { color: string; text: string }> = {
      free: { color: "default", text: "Free" },
      plus: { color: "gold", text: "Plus" },
      team: { color: "green", text: "Team" },
      plus_team: { color: "purple", text: "Plus+Team" },
    };
    const config = subscriptionMap[subscriptionType || ""] || { color: "default", text: "未刷新" };
    return <Tag color={config.color}>{config.text}</Tag>;
  };

  const getStatusTag = (status: string) => {
    const statusMap: Record<string, { color: string; text: string }> = {
      active: { color: "success", text: "活跃" },
      abnormal: { color: "error", text: "异常" },
    };
    const config = statusMap[status] || statusMap.abnormal;
    return <Tag color={config.color}>{config.text}</Tag>;
  };

  const getHealthIcon = (health: string) => {
    const iconMap: Record<string, React.ReactElement> = {
      healthy: <CheckCircleOutlined style={{ color: "#52c41a" }} />,
      warning: <WarningOutlined style={{ color: "#faad14" }} />,
      invalid: <CloseCircleOutlined style={{ color: "#ff4d4f" }} />,
      unknown: <ClockCircleOutlined style={{ color: "#d9d9d9" }} />,
    };
    return iconMap[health] || iconMap.unknown;
  };

  const getRegistrationSourceText = (source: string) => {
    const sourceMap: Record<string, string> = {
      manual: "手动",
      batch_register: "批量注册",
      batch_login: "批量登录",
      import: "导入",
      payment_register: "支付注册",
    };
    return sourceMap[source] || source;
  };

  // 格式化支付链接，隐藏中间部分
  const formatPaymentUrl = (url: string | undefined, prefix: string): string => {
    if (!url) return "";
    // 提取链接中的关键部分（通常是最后的ID或token）
    const parts = url.split("/");
    const lastPart = parts[parts.length - 1] || "";
    if (lastPart.length > 12) {
      const start = lastPart.substring(0, 4);
      const end = lastPart.substring(lastPart.length - 4);
      return `${prefix}:${start}****${end}`;
    }
    return `${prefix}:${lastPart}`;
  };

  // 复制到剪贴板
  const handleCopyUrl = (url: string, type: string) => {
    navigator.clipboard.writeText(url).then(() => {
      message.success(`${type} 链接已复制`);
    }).catch(() => {
      message.error("复制失败");
    });
  };

  // 复制密码
  const handleCopyPassword = (password: string) => {
    navigator.clipboard.writeText(password).then(() => {
      message.success("密码已复制");
    }).catch(() => {
      message.error("复制失败");
    });
  };

  const handleCopyToken = (token: string, label: string) => {
    navigator.clipboard.writeText(token).then(() => {
      message.success(`${label} 已复制`);
    }).catch(() => {
      message.error("复制失败");
    });
  };

  const handleLoadTeamMembers = async (account: ChatGPTAccount) => {
    setLoadingTeamMemberIds(prev => new Set(prev).add(account.id));
    try {
      const res = await fetch(`/api/chatgpt/accounts/${account.id}/team-members`);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "查询 Team 成员失败");
      }

      const count = data.workspace?.raw?.total ?? data.workspace?.users?.length ?? 0;
      setAccounts(prev => prev.map(item => (
        item.id === account.id ? {
          ...item,
          team_member_count: count,
          team_members_refreshed_at: new Date().toISOString(),
        } : item
      )));
      setTeamMembersModal(data);
    } catch (error) {
      message.error(getErrorMessage(error, "查询 Team 成员失败"));
    } finally {
      setLoadingTeamMemberIds(prev => {
        const newSet = new Set(prev);
        newSet.delete(account.id);
        return newSet;
      });
    }
  };

  const openInviteModal = (account: ChatGPTAccount) => {
    setInviteModalAccount(account);
    setInviteTargetIds([]);
  };

  const handleInviteAccounts = async () => {
    if (!inviteModalAccount) {
      return;
    }
    if (inviteTargetIds.length === 0) {
      message.warning("请选择要邀请的账号");
      return;
    }

    setInviting(true);
    try {
      const res = await fetch(`/api/chatgpt/accounts/${inviteModalAccount.id}/team-invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invited_account_ids: inviteTargetIds }),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "邀请失败");
      }

      const inviteResults = Array.isArray(data.results) ? data.results : [];
      const failedResults = inviteResults.filter((item: { invited?: boolean; accepted?: boolean }) => (
        !item.invited || !item.accepted
      ));
      if (failedResults.length > 0) {
        Modal.warning({
          title: "邀请已执行，部分账号未确认加入",
          content: (
            <Space direction="vertical" size={4}>
              {failedResults.map((item: { email?: string; error?: string }, index: number) => (
                <Text key={`${item.email || index}`} type="secondary">
                  {item.email || "未知账号"}：{item.error || "未确认加入"}
                </Text>
              ))}
            </Space>
          ),
        });
      } else {
        message.success(`邀请完成，当前成员 ${data.team_member_count ?? "-"} 人`);
      }
      setAccounts(prev => prev.map(item => (
        item.id === inviteModalAccount.id
          ? {
              ...item,
              team_member_count: data.team_member_count,
              team_members_refreshed_at: new Date().toISOString(),
            }
          : item
      )));
      setInviteModalAccount(null);
      setInviteTargetIds([]);
    } catch (error) {
      message.error(getErrorMessage(error, "邀请失败"));
    } finally {
      setInviting(false);
    }
  };

  // 复制邮箱
  const handleCopyEmail = (email: string) => {
    navigator.clipboard.writeText(email).then(() => {
      message.success("邮箱已复制");
    }).catch(() => {
      message.error("复制失败");
    });
  };

  // 提取 tokens
  const handleExtractTokens = async (account: ChatGPTAccount) => {
    try {
      message.loading({ content: "正在提取 tokens...", key: `extract-${account.id}`, duration: 0 });

      const res = await fetch("/api/chatgpt/extract-tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_id: account.id,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "提取失败");
      }

      message.success({
        content: `成功提取 ${data.workspaces?.length || 0} 个 workspace 的 tokens`,
        key: `extract-${account.id}`,
      });

      fetchAccounts();
    } catch (error) {
      message.error({
        content: getErrorMessage(error, "提取失败"),
        key: `extract-${account.id}`,
      });
    }
  };

  // 刷新账号空间数据
  const handleRefreshAccount = async (account: ChatGPTAccount) => {
    setRefreshingAccountIds(prev => new Set(prev).add(account.id));

    try {
      message.loading({
        content: "正在登录并刷新账号空间...",
        key: `refresh-${account.id}`,
        duration: 0,
      });

      const res = await fetch("/api/chatgpt/refresh-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_id: account.id,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "刷新失败");
      }

      message.success({
        content: `刷新成功：${data.subscription_type || "未知订阅"}，${data.workspaces?.length || 0} 个 workspace`,
        key: `refresh-${account.id}`,
      });

      fetchAccounts();
    } catch (error) {
      message.error({
        content: getErrorMessage(error, "刷新失败"),
        key: `refresh-${account.id}`,
      });
    } finally {
      setRefreshingAccountIds(prev => {
        const newSet = new Set(prev);
        newSet.delete(account.id);
        return newSet;
      });
    }
  };

  const openBatchRefreshModal = () => {
    if (selectedRowKeys.length === 0) {
      message.warning("请先选择要刷新的账号");
      return;
    }
    if (selectedRefreshableCount === 0) {
      message.info("选中的账号 tokens 已满 6 个且没有 free 个人 token，无需刷新");
      return;
    }

    batchRefreshForm.setFieldsValue({ concurrency: 3 });
    setBatchRefreshModalVisible(true);
  };

  const handleBatchRefreshAccounts = async (values?: BatchRefreshFormValues) => {
    const selectedAccountIds = accounts
      .filter(account => selectedRowKeys.includes(account.id) && shouldShowTokenRefresh(account))
      .map(account => account.id);
    if (selectedAccountIds.length === 0) {
      message.info("选中的账号 tokens 已满 6 个且没有 free 个人 token，无需刷新");
      return;
    }

    const concurrency = Math.min(
      Math.max(Number(values?.concurrency || 3), 1),
      Math.min(selectedAccountIds.length, 10),
    );
    let cursor = 0;
    let successCount = 0;
    const failedItems: string[] = [];
    const messageKey = "batch-refresh-accounts";

    setBatchRefreshing(true);
    setBatchRefreshModalVisible(false);
    setRefreshingAccountIds(prev => {
      const next = new Set(prev);
      selectedAccountIds.forEach(id => next.add(id));
      return next;
    });

    try {
      message.loading({
        content: `批量刷新中：0/${selectedAccountIds.length}，并发 ${concurrency}`,
        key: messageKey,
        duration: 0,
      });

      const refreshOne = async (accountId: number) => {
        try {
          const res = await fetch("/api/chatgpt/refresh-account", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ account_id: accountId }),
          });
          const data = await res.json();
          if (!res.ok) {
            throw new Error(data.error || "刷新失败");
          }
          successCount += 1;
        } catch (error) {
          const account = accounts.find(item => item.id === accountId);
          failedItems.push(`${account?.email || accountId}: ${getErrorMessage(error, "刷新失败")}`);
        } finally {
          setRefreshingAccountIds(prev => {
            const next = new Set(prev);
            next.delete(accountId);
            return next;
          });
          message.loading({
            content: `批量刷新中：${successCount + failedItems.length}/${selectedAccountIds.length}，并发 ${concurrency}`,
            key: messageKey,
            duration: 0,
          });
        }
      };

      const workers = Array.from({ length: concurrency }, async () => {
        while (cursor < selectedAccountIds.length) {
          const accountId = selectedAccountIds[cursor];
          cursor += 1;
          await refreshOne(accountId);
        }
      });

      await Promise.all(workers);

      if (failedItems.length > 0) {
        message.warning({
          content: `批量刷新完成：成功 ${successCount} 个，失败 ${failedItems.length} 个`,
          key: messageKey,
          duration: 5,
        });
        Modal.warning({
          title: "批量刷新完成，有账号失败",
          content: (
            <div style={{ maxHeight: 320, overflow: "auto" }}>
              {failedItems.map((item, index) => (
                <div key={`${item}-${index}`} style={{ marginBottom: 8 }}>
                  {item}
                </div>
              ))}
            </div>
          ),
          width: 680,
        });
      } else {
        message.success({
          content: `批量刷新完成：成功 ${successCount} 个`,
          key: messageKey,
        });
      }

      fetchAccounts();
    } finally {
      setBatchRefreshing(false);
      setRefreshingAccountIds(prev => {
        const next = new Set(prev);
        selectedAccountIds.forEach(id => next.delete(id));
        return next;
      });
    }
  };

  const handleBatchRefreshSubscriptions = async () => {
    const accountIds = selectedRowKeys.map(Number).filter(Number.isFinite);
    if (accountIds.length === 0) {
      message.warning("请先选择要刷新的账号");
      return;
    }

    let successCount = 0;
    const failedItems: string[] = [];
    const messageKey = "batch-refresh-subscriptions";

    setBatchRefreshing(true);
    setRefreshingAccountIds(prev => {
      const next = new Set(prev);
      accountIds.forEach(id => next.add(id));
      return next;
    });

    try {
      message.loading({
        content: `批量刷新订阅中：0/${accountIds.length}`,
        key: messageKey,
        duration: 0,
      });

      for (const accountId of accountIds) {
        try {
          const res = await fetch("/api/chatgpt/refresh-subscription", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              account_id: accountId,
            }),
          });
          const data = await res.json();
          if (!res.ok) {
            throw new Error(data.error || "刷新失败");
          }
          successCount += 1;
        } catch (error) {
          const account = accounts.find(item => item.id === accountId);
          failedItems.push(`${account?.email || accountId}: ${getErrorMessage(error, "刷新失败")}`);
        } finally {
          setRefreshingAccountIds(prev => {
            const next = new Set(prev);
            next.delete(accountId);
            return next;
          });
          message.loading({
            content: `批量刷新订阅中：${successCount + failedItems.length}/${accountIds.length}`,
            key: messageKey,
            duration: 0,
          });
        }
      }

      if (failedItems.length > 0) {
        message.warning({
          content: `批量完成：成功 ${successCount} 个，失败 ${failedItems.length} 个`,
          key: messageKey,
          duration: 6,
        });
      } else {
        message.success({
          content: `批量完成：成功 ${successCount} 个`,
          key: messageKey,
        });
      }
      fetchAccounts();
    } finally {
      setBatchRefreshing(false);
      setRefreshingAccountIds(prev => {
        const next = new Set(prev);
        accountIds.forEach(id => next.delete(id));
        return next;
      });
    }
  };

  // 导出支付链接
  const handleExportPaymentLinks = async () => {
    setExporting(true);
    try {
      const accountIds = selectedRowKeys.map(Number).filter(Number.isFinite);
      const res = await fetch("/api/chatgpt/export-payment-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account_ids: accountIds }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "导出失败");
      }

      // 下载 ZIP 文件
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;

      // 从响应头获取文件名
      const contentDisposition = res.headers.get("Content-Disposition");
      let filename = "payment-links.zip";
      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename="?(.+)"?/);
        if (filenameMatch) {
          filename = filenameMatch[1];
        }
      }

      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      message.success(accountIds.length > 0 ? "已导出选中账号的支付链接" : "支付链接已导出");

      // 刷新列表
      fetchAccounts();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "导出失败");
    } finally {
      setExporting(false);
    }
  };

  // 导出 sub2api 格式
  const handleExportSub2api = async () => {
    setExportingSub2api(true);
    try {
      const res = await fetch("/api/chatgpt/export-sub2api", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account_ids: selectedRowKeys.map(Number).filter(Number.isFinite) }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "导出失败");
      }

      const data = await res.json();

      // 创建并下载文件
      const blob = new Blob([data.content], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = data.filename || `sub2api_batch_import.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      const scopeText = selectedRowKeys.length > 0 ? `选中的 ${data.account_count || selectedRowKeys.length} 个账号` : "全部账号";
      message.success(`已导出${scopeText}的 ${data.count} 个 workspace 账号`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "导出失败");
    } finally {
      setExportingSub2api(false);
    }
  };

  const loadSub2ApiSites = async (): Promise<Sub2ApiSiteOption[]> => {
    setLoadingSub2apiSites(true);
    try {
      const res = await fetch("/api/sub2api-sites");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "加载 Sub2API 站点失败");
      }
      const sites = (Array.isArray(data.sites) ? data.sites : [])
        .map((site: Sub2ApiSiteOption & { id: number | string }) => ({
          id: Number(site.id),
          name: site.name,
          api_url: site.api_url,
          status: site.status,
        }))
        .filter((site: Sub2ApiSiteOption) => Number.isFinite(site.id) && site.status === "active");
      setSub2apiSites(sites);
      return sites;
    } catch (error) {
      message.error(getErrorMessage(error, "加载 Sub2API 站点失败"));
      return [];
    } finally {
      setLoadingSub2apiSites(false);
    }
  };

  const loadSub2ApiGroups = async (siteId: number): Promise<Sub2ApiGroupOption[]> => {
    if (!siteId) {
      setSub2apiGroups([]);
      return [];
    }

    setLoadingSub2apiGroups(true);
    try {
      const res = await fetch(`/api/sub2api-sites/${siteId}/groups`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "加载 Sub2API 分组失败");
      }
      const groups = (Array.isArray(data.groups) ? data.groups : [])
        .map((group: Sub2ApiGroupOption & { id: number | string }) => ({
          id: Number(group.id),
          name: group.name,
          account_count: group.account_count,
          active_account_count: group.active_account_count,
          rate_limited_account_count: group.rate_limited_account_count,
          threshold_available: group.threshold_available,
        }))
        .filter((group: Sub2ApiGroupOption) => Number.isFinite(group.id));
      setSub2apiGroups(groups);
      return groups;
    } catch (error) {
      message.error(getErrorMessage(error, "加载 Sub2API 分组失败"));
      setSub2apiGroups([]);
      return [];
    } finally {
      setLoadingSub2apiGroups(false);
    }
  };

  const openPushSub2apiModal = async (accountIds?: number[]) => {
    const resolvedAccountIds = (accountIds && accountIds.length > 0)
      ? accountIds
      : selectedRowKeys.map(Number).filter(Number.isFinite);
    if (resolvedAccountIds.length === 0) {
      message.warning("请先选择要推送的账号");
      return;
    }

    setPushSub2apiTargetIds(resolvedAccountIds);
    setPushSub2apiModalVisible(true);
    const sites = sub2apiSites.length ? sub2apiSites : await loadSub2ApiSites();
    const firstSite = sites[0];
    if (firstSite) {
      pushSub2apiForm.setFieldsValue({ site_id: firstSite.id, group_id: undefined });
      await loadSub2ApiGroups(firstSite.id);
    }
  };

  const handlePushSub2api = async (values: PushSub2ApiFormValues) => {
    const accountIds = pushSub2apiTargetIds;
    if (accountIds.length === 0) {
      message.warning("请先选择要推送的账号");
      return;
    }

    setPushingSub2api(true);
    try {
      const res = await fetch("/api/chatgpt/push-sub2api", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_ids: accountIds,
          site_id: values.site_id,
          group_id: values.group_id,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "推送失败");
      }

      const failed = Number(data.failed || 0);
      const uploaded = Number(data.uploaded || 0);
      const skipped = Number(data.skipped_account_count || 0);
      const summary = `推送完成：上传 ${uploaded} 个 workspace${skipped ? `，跳过 ${skipped} 个无可用 token 账号` : ""}${failed ? `，失败 ${failed} 个` : ""}`;
      if (failed > 0) {
        message.warning(summary);
        Modal.warning({
          title: "推送完成，有 workspace 失败",
          content: (
            <div style={{ maxHeight: 320, overflow: "auto" }}>
              {(Array.isArray(data.failures) ? data.failures : []).map((
                item: { account_id?: number; workspace_id?: string; error?: string },
                index: number
              ) => (
                <div key={`${item.account_id || index}-${item.workspace_id || index}`} style={{ marginBottom: 8 }}>
                  账号 {item.account_id || "-"} / {item.workspace_id || "-"}：{item.error || "上传失败"}
                </div>
              ))}
            </div>
          ),
          width: 680,
        });
      } else {
        message.success(summary);
      }

      setPushSub2apiModalVisible(false);
      setPushSub2apiTargetIds([]);
      pushSub2apiForm.resetFields();
      fetchAccounts();
    } catch (error) {
      message.error(getErrorMessage(error, "推送失败"));
    } finally {
      setPushingSub2api(false);
    }
  };

  // 删除单个账号
  const handleDeleteAccount = async (accountId: number) => {
    Modal.confirm({
      title: "确认删除",
      content: "确定要删除这个账号吗？此操作不可恢复。",
      okText: "删除",
      okType: "danger",
      cancelText: "取消",
      onOk: async () => {
        try {
          const res = await fetch(`/api/chatgpt/accounts?id=${accountId}`, {
            method: "DELETE",
          });

          if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error || "删除失败");
          }

          message.success("删除成功");
          fetchAccounts();
        } catch (error) {
          message.error(error instanceof Error ? error.message : "删除失败");
        }
      },
    });
  };

  // 批量删除账号
  const handleBatchDelete = async () => {
    if (selectedRowKeys.length === 0) {
      message.warning("请先选择要删除的账号");
      return;
    }

    Modal.confirm({
      title: "确认批量删除",
      content: `确定要删除选中的 ${selectedRowKeys.length} 个账号吗？此操作不可恢复。`,
      okText: "删除",
      okType: "danger",
      cancelText: "取消",
      onOk: async () => {
        setDeleting(true);
        try {
          const res = await fetch("/api/chatgpt/accounts/batch-delete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ids: selectedRowKeys }),
          });

          if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error || "批量删除失败");
          }

          const data = await res.json();
          message.success(`成功删除 ${data.deleted_count} 个账号`);
          setSelectedRowKeys([]);
          fetchAccounts();
        } catch (error) {
          message.error(error instanceof Error ? error.message : "批量删除失败");
        } finally {
          setDeleting(false);
        }
      },
    });
  };

  // 获取行的背景色（每5行一组，交替颜色）
  const getRowBackgroundColor = (index: number): string => {
    const groupIndex = Math.floor(index / 5);
    const colors = ["#e6f4ff", "#f0f5ff"]; // 绿色和蓝色系
    return colors[groupIndex % colors.length];
  };

  const renderSub2ApiBindings = (record: ChatGPTAccount, compact = false) => {
    const uploads = (record.sub2api_uploads || []).filter((item) => item.status === "success");
    if (!uploads.length) {
      return <Text type="secondary">未上传</Text>;
    }

    const grouped = uploads.reduce<Record<string, Sub2ApiUploadBinding[]>>((map, item) => {
      const key = `${item.site_name || item.site_id}#${item.group_id}`;
      map[key] = [...(map[key] || []), item];
      return map;
    }, {});

    return (
      <Space direction={compact ? "horizontal" : "vertical"} size={4} wrap={compact}>
        {Object.entries(grouped).map(([key, items]) => {
          const first = items[0];
          return (
            <Tag key={key} color="processing" style={{ marginInlineEnd: 0 }}>
              {first.site_name || `站点 ${first.site_id}`} / {first.group_name || "分组"} #{first.group_id} · {items.length}
            </Tag>
          );
        })}
      </Space>
    );
  };

  const renderTokenSummary = (record: ChatGPTAccount) => {
    const stats = getWorkspaceTokenStats(record);
    if (!stats.total) {
      return <Text type="secondary">未提取</Text>;
    }

    return (
      <Space size={6} wrap>
        <Tag color="processing">{stats.total} 个</Tag>
        {stats.plus > 0 && <Tag color="gold">Plus {stats.plus}</Tag>}
        {stats.team > 0 && <Tag color="green">Team {stats.team}</Tag>}
        <Button type="link" size="small" onClick={() => setTokenModalAccount(record)} style={{ paddingInline: 0 }}>
          查看
        </Button>
      </Space>
    );
  };

  const renderTeamMemberSummary = (record: ChatGPTAccount) => {
    if (!record.team_workspace_id) {
      return <Text type="secondary">未记录</Text>;
    }

    const memberCount = record.team_member_count;
    const isLoading = loadingTeamMemberIds.has(record.id);

    return (
      <Space size={6}>
        <Tag color={memberCount === undefined ? "default" : "processing"}>
          {memberCount === undefined || memberCount === null ? "未查询" : `${memberCount} 人`}
        </Tag>
        <Button
          type="link"
          size="small"
          onClick={() => handleLoadTeamMembers(record)}
          loading={isLoading}
          style={{ paddingInline: 0 }}
        >
          查看
        </Button>
      </Space>
    );
  };

  const getAccountMoreActionItems = (record: ChatGPTAccount): MenuProps["items"] => {
    const hasEmailServiceId = !!record.email_service_id;
    const hasSubscription = ["plus", "team", "plus_team"].includes(record.subscription_type || "");
    const showTokenRefresh = shouldShowTokenRefresh(record);
    const canInvite = shouldShowInviteAction(record);

    return [
      canInvite
        ? {
            key: "invite",
            label: "邀请",
            icon: <PlusOutlined />,
          }
        : null,
      hasSubscription && showTokenRefresh
        ? {
            key: "extract",
            label: "提取",
            icon: <ExportOutlined />,
            disabled: !hasEmailServiceId,
          }
        : null,
      {
        key: "delete",
        label: "删除",
        icon: <DeleteOutlined />,
        danger: true,
      },
    ].filter(Boolean) as MenuProps["items"];
  };

  const handleAccountMoreActionClick = (record: ChatGPTAccount, key: string) => {
    if (key === "invite") {
      openInviteModal(record);
    } else if (key === "extract") {
      handleExtractTokens(record);
    } else if (key === "delete") {
      handleDeleteAccount(record.id);
    }
  };

  const renderAccountActions = (record: ChatGPTAccount, compact = false) => {
    const isRefreshing = refreshingAccountIds.has(record.id);
    const hasEmailServiceId = !!record.email_service_id;
    const showTokenRefresh = shouldShowTokenRefresh(record);
    const hasWorkspaceTokens = getWorkspaceTokens(record).length > 0;
    const moreActionItems = getAccountMoreActionItems(record);

    return (
      <Space size={compact ? 4 : "small"} wrap>
        {hasWorkspaceTokens && (
          <Button
            type={compact ? "default" : "link"}
            size="small"
            icon={<UploadOutlined />}
            onClick={() => openPushSub2apiModal([record.id])}
          >
            推送
          </Button>
        )}
        {showTokenRefresh && (
          <Tooltip title={!hasEmailServiceId ? "缺少 MoeMail 邮箱 ID" : "登录账号并刷新空间"}>
            <Button
              type={compact ? "default" : "link"}
              size="small"
              icon={<ReloadOutlined />}
              onClick={() => handleRefreshAccount(record)}
              loading={isRefreshing}
              disabled={!hasEmailServiceId}
            >
              刷新
            </Button>
          </Tooltip>
        )}
        {!!moreActionItems?.length && (
          <Dropdown
            trigger={["click"]}
            menu={{
              items: moreActionItems,
              onClick: ({ key }) => handleAccountMoreActionClick(record, key),
            }}
          >
            <Button type={compact ? "default" : "link"} size="small" icon={<DownOutlined />}>
              更多
            </Button>
          </Dropdown>
        )}
      </Space>
    );
  };

  const renderAccountCard = (account: ChatGPTAccount, index: number) => {
    const selected = selectedRowKeys.includes(account.id);

    return (
      <Card
        key={account.id}
        size="small"
        style={{
          background: getRowBackgroundColor(index),
          borderColor: selected ? "#1677ff" : undefined,
        }}
        styles={{ body: { padding: 12 } }}
      >
        <Flex vertical gap={10}>
          <Flex align="flex-start" justify="space-between" gap={8}>
            <Flex align="flex-start" gap={8} style={{ minWidth: 0 }}>
              <Checkbox
                checked={selected}
                onChange={(event) => {
                  setSelectedRowKeys(prev => (
                    event.target.checked
                      ? Array.from(new Set([...prev, account.id]))
                      : prev.filter(key => key !== account.id)
                  ));
                }}
              />
              <Flex vertical gap={4} style={{ minWidth: 0 }}>
                <Tooltip title={account.email}>
                  <Text
                    strong
                    ellipsis
                    onClick={() => handleCopyEmail(account.email)}
                    style={{ maxWidth: "calc(100vw - 118px)", cursor: "pointer" }}
                  >
                    {account.email}
                  </Text>
                </Tooltip>
                <Space size={4} wrap>
                  {getStatusTag(account.status)}
                  {getSubscriptionTag(account.subscription_type)}
                  <Tag color={account.card_type === "长效" ? "green" : "blue"}>
                    {account.card_type === "长效" ? "长效" : "短效"}
                  </Tag>
                </Space>
              </Flex>
            </Flex>
            <Tooltip title={account.health_status}>
              <span>{getHealthIcon(account.health_status)}</span>
            </Tooltip>
          </Flex>

          <Flex vertical gap={6}>
            <Flex justify="space-between" gap={8}>
              <Text type="secondary">Tokens</Text>
              <div style={{ textAlign: "right" }}>{renderTokenSummary(account)}</div>
            </Flex>
            <Flex justify="space-between" gap={8}>
              <Text type="secondary">Team</Text>
              <div style={{ textAlign: "right" }}>{renderTeamMemberSummary(account)}</div>
            </Flex>
            <Flex justify="space-between" gap={8} align="flex-start">
              <Text type="secondary">Sub2API</Text>
              <div style={{ textAlign: "right", minWidth: 0 }}>{renderSub2ApiBindings(account, true)}</div>
            </Flex>
          </Flex>

          <Flex justify="space-between" align="center" gap={8}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {account.region || "-"} · {getRegistrationSourceText(account.registration_source)}
            </Text>
            {renderAccountActions(account, true)}
          </Flex>
        </Flex>
      </Card>
    );
  };

  const columns: ColumnsType<ChatGPTAccount> = [
    {
      title: "邮箱",
      dataIndex: "email",
      key: "email",
      width: 320,
      fixed: "left" as const,
      render: (email: string, record: ChatGPTAccount) => (
        <Flex vertical gap={4}>
          <Space size={4} style={{ minWidth: 0 }}>
            <Tooltip title={email}>
              <Text
                strong
                ellipsis
                style={{ maxWidth: 250, cursor: "pointer" }}
                onClick={() => handleCopyEmail(email)}
              >
                {email}
              </Text>
            </Tooltip>
            <Button
              type="text"
              size="small"
              icon={<CopyOutlined />}
              onClick={() => handleCopyEmail(email)}
            />
          </Space>
          {record.password ? (
            <Text
              style={{
                fontSize: 12,
                cursor: "pointer",
                color: "#1890ff",
                transition: "all 0.2s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.opacity = "0.7";
                e.currentTarget.style.textDecoration = "underline";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.opacity = "1";
                e.currentTarget.style.textDecoration = "none";
              }}
              onClick={() => handleCopyPassword(record.password!)}
            >
              密码: {record.password.length > 8 ? `${record.password.substring(0, 4)}****${record.password.substring(record.password.length - 2)}` : "****"}
            </Text>
          ) : (
            <Text type="secondary" style={{ fontSize: 12 }}>密码: -</Text>
          )}
          {record.email_service_id && (
            <Text type="secondary" style={{ fontSize: 11 }}>
              ID: {record.email_service_id}
            </Text>
          )}
        </Flex>
      ),
    },
    {
      title: "绑卡类型",
      dataIndex: "card_type",
      key: "card_type",
      width: 100,
      render: (cardType?: string) => (
        <Tag color={cardType === "长效" ? "green" : "blue"}>
          {cardType === "长效" ? "长效" : "短效"}
        </Tag>
      ),
    },
    {
      title: "订阅",
      dataIndex: "subscription_type",
      key: "subscription_type",
      width: 110,
      render: (subscriptionType?: string) => getSubscriptionTag(subscriptionType),
    },
    {
      title: "Team 成员",
      key: "team_members",
      width: 130,
      render: (_: unknown, record: ChatGPTAccount) => renderTeamMemberSummary(record),
    },
    {
      title: "Tokens",
      key: "workspace_tokens",
      width: 120,
      render: (_: unknown, record: ChatGPTAccount) => renderTokenSummary(record),
    },
    {
      title: "Sub2API 绑定",
      key: "sub2api_uploads",
      width: 220,
      render: (_: unknown, record: ChatGPTAccount) => renderSub2ApiBindings(record),
    },
    {
      title: "支付链接",
      key: "payment_links",
      width: 200,
      render: (_: unknown, record: ChatGPTAccount) => {
        const hasPlus = !!record.checkout_url;
        const hasTeam = !!record.team_checkout_url;

        if (!hasPlus && !hasTeam) {
          return <Text type="secondary">-</Text>;
        }

        return (
          <Flex vertical gap={4}>
            {hasPlus && (
              <Text
                style={{
                  fontSize: 12,
                  cursor: "pointer",
                  color: "#1890ff",
                  transition: "all 0.2s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.opacity = "0.7";
                  e.currentTarget.style.textDecoration = "underline";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.opacity = "1";
                  e.currentTarget.style.textDecoration = "none";
                }}
                onClick={() => handleCopyUrl(record.checkout_url!, "Plus")}
              >
                {formatPaymentUrl(record.checkout_url, "plus")}
              </Text>
            )}
            {hasTeam && (
              <Text
                style={{
                  fontSize: 12,
                  cursor: "pointer",
                  color: "#52c41a",
                  transition: "all 0.2s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.opacity = "0.7";
                  e.currentTarget.style.textDecoration = "underline";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.opacity = "1";
                  e.currentTarget.style.textDecoration = "none";
                }}
                onClick={() => handleCopyUrl(record.team_checkout_url!, "Team")}
              >
                {formatPaymentUrl(record.team_checkout_url, "team")}
              </Text>
            )}
          </Flex>
        );
      },
    },
    {
      title: "账号状态",
      dataIndex: "status",
      key: "status",
      width: 100,
      render: (status: string) => getStatusTag(status),
    },
    {
      title: "地区",
      dataIndex: "region",
      key: "region",
      width: 80,
      render: (region?: string) => {
        if (!region) {
          return <Text type="secondary">-</Text>;
        }

        // 地区代码映射
        const regionMap: Record<string, { flag: string; name: string }> = {
          US: { flag: "🇺🇸", name: "美国" },
          DE: { flag: "🇩🇪", name: "德国" },
          GB: { flag: "🇬🇧", name: "英国" },
          FR: { flag: "🇫🇷", name: "法国" },
          JP: { flag: "🇯🇵", name: "日本" },
          CA: { flag: "🇨🇦", name: "加拿大" },
          AU: { flag: "🇦🇺", name: "澳大利亚" },
          SG: { flag: "🇸🇬", name: "新加坡" },
          HK: { flag: "🇭🇰", name: "香港" },
          TW: { flag: "🇹🇼", name: "台湾" },
        };

        const regionInfo = regionMap[region.toUpperCase()] || { flag: "🌍", name: region };

        return (
          <Tooltip title={regionInfo.name}>
            <Tag>
              <span style={{ marginRight: 4 }}>{regionInfo.flag}</span>
              {region.toUpperCase()}
            </Tag>
          </Tooltip>
        );
      },
    },
    {
      title: "导出状态",
      dataIndex: "exported",
      key: "exported",
      width: 100,
      render: (exported: boolean, record: ChatGPTAccount) => (
        <Flex vertical gap={2}>
          <Tag color={exported ? "success" : "default"}>
            {exported ? "已导出" : "未导出"}
          </Tag>
          {exported && record.exported_at && (
            <Text type="secondary" style={{ fontSize: 11 }}>
              {new Date(record.exported_at).toLocaleDateString()}
            </Text>
          )}
        </Flex>
      ),
    },
    {
      title: "操作",
      key: "actions",
      width: 200,
      fixed: "right" as const,
      render: (_: unknown, record: ChatGPTAccount) => renderAccountActions(record),
    },
  ];

  return (
    <Flex
      vertical
      gap={16}
      style={{
        height: isMobile ? "auto" : "calc(100vh - var(--arm-header-height) - 48px)",
        minHeight: isMobile ? "calc(100dvh - var(--arm-header-height) - 32px)" : 0,
        minWidth: 0,
      }}
    >
      {/* 顶部搜索栏 */}
      <Card className="arm-responsive-card">
        <Flex className="arm-page-toolbar" gap={12} align="center" justify="space-between" wrap={!isMobile}>
          <Input
            allowClear
            value={searchValue}
            onChange={(e) => {
              setSearchValue(e.target.value);
              setCurrentPage(1);
            }}
            prefix={<SearchOutlined />}
            placeholder="搜索邮箱或 ID"
            style={{ flex: isMobile ? 1 : undefined, width: isMobile ? undefined : "100%", maxWidth: isMobile ? undefined : 400 }}
          />
          {isMobile ? (
            <Space.Compact>
              <Button
                type="primary"
                icon={<DollarOutlined />}
                onClick={() => setPaymentModalVisible(true)}
              >
                注册
              </Button>
              <Dropdown
                trigger={["click"]}
                getPopupContainer={() => document.body}
                overlayStyle={{ zIndex: 1200 }}
                menu={{
                  items: [
                    {
                      key: "refresh",
                      label: "刷新列表",
                      icon: <ReloadOutlined />,
                    },
                    {
                      key: "export-payment-links",
                      label: selectedRowKeys.length > 0 ? `导出选中支付链接 (${selectedRowKeys.length})` : "导出支付链接",
                      icon: <ExportOutlined />,
                      disabled: exporting,
                    },
                    {
                      type: "divider",
                    },
                    {
                      key: "selection",
                      label: selectedRowKeys.length > 0 ? `选择账号 (${selectedRowKeys.length})` : "选择账号",
                      icon: <CheckCircleOutlined />,
                      children: selectionPresets.map((preset) => ({
                        key: `select:${preset.key}`,
                        label: preset.text,
                      })),
                    },
                    {
                      type: "divider",
                    },
                    ...(bulkActionItems || []),
                  ],
                  onClick: ({ key }) => {
                    if (key === "refresh") {
                      fetchAccounts();
                    } else if (key === "export-payment-links") {
                      handleExportPaymentLinks();
                    } else if (String(key).startsWith("select:")) {
                      selectionPresets.find((preset) => preset.key === String(key).replace("select:", ""))?.onSelect();
                    } else {
                      handleBulkActionClick(key);
                    }
                  },
                }}
              >
                <Button
                  icon={<MoreOutlined />}
                  loading={bulkActionLoading || exporting}
                />
              </Dropdown>
            </Space.Compact>
          ) : (
            <Space wrap style={{ justifyContent: "flex-end" }}>
              <Dropdown
                trigger={["click"]}
                getPopupContainer={() => document.body}
                overlayStyle={{ zIndex: 1200 }}
                menu={{
                  items: selectionPresets.map((preset) => ({
                    key: preset.key,
                    label: preset.text,
                  })),
                  onClick: ({ key }) => {
                    selectionPresets.find((preset) => preset.key === key)?.onSelect();
                  },
                }}
              >
                <Button
                  icon={<DownOutlined />}
                  type={selectedRowKeys.length > 0 ? "primary" : "default"}
                >
                  选择账号 {selectedRowKeys.length > 0 && `(${selectedRowKeys.length})`}
                </Button>
              </Dropdown>
              <Button
                icon={<ReloadOutlined />}
                onClick={() => {
                  fetchAccounts();
                }}
              >
                刷新
              </Button>
              <Button
                type="primary"
                icon={<DollarOutlined />}
                onClick={() => setPaymentModalVisible(true)}
              >
                支付注册
              </Button>
              <Button
                icon={<ExportOutlined />}
                onClick={handleExportPaymentLinks}
                loading={exporting}
              >
                {selectedRowKeys.length > 0 ? `导出选中支付链接 (${selectedRowKeys.length})` : "导出支付链接"}
              </Button>
              {hasBulkSelection && (
                <Dropdown
                  trigger={["click"]}
                  getPopupContainer={() => document.body}
                  overlayStyle={{ zIndex: 1200 }}
                  menu={{
                    items: bulkActionItems,
                    onClick: ({ key }) => handleBulkActionClick(key),
                  }}
                >
                  <Button
                    icon={<MoreOutlined />}
                    type="primary"
                    loading={bulkActionLoading}
                  >
                    批量操作 ({selectedAccountIds.length})
                  </Button>
                </Dropdown>
              )}
            </Space>
          )}
        </Flex>
      </Card>

      {/* 账号表格 */}
      <Card
        className="arm-table-card"
        style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}
        styles={{ body: { flex: 1, display: "flex", flexDirection: "column", minHeight: 0, padding: 0 } }}
      >
        <div style={{ flex: 1, minHeight: 0, overflow: isMobile ? "auto" : undefined }}>
          {isMobile ? (
            <Spin spinning={loading}>
              {filteredAccounts.length > 0 ? (
                <Flex vertical gap={12} style={{ padding: 12 }}>
                  {filteredAccounts.map(renderAccountCard)}
                </Flex>
              ) : (
                <Empty description="暂无账号" style={{ padding: "48px 0" }} />
              )}
            </Spin>
          ) : (
            <Table
              size="middle"
              columns={columns}
              dataSource={filteredAccounts}
              rowKey="id"
              loading={loading}
              rowSelection={{
                selectedRowKeys,
                onChange: (keys) => setSelectedRowKeys(keys),
                preserveSelectedRowKeys: true,
              }}
              pagination={false}
              scroll={{
                x: 1900,
                y: "calc(100vh - var(--arm-header-height) - 340px)",
              }}
              onRow={(record, index) => ({
                style: {
                  backgroundColor: getRowBackgroundColor(index || 0),
                },
              })}
              locale={{ emptyText: <Empty description="暂无账号" /> }}
            />
          )}
        </div>
        <Flex
          justify="flex-end"
          align="center"
          wrap
          style={{
            padding: "12px 16px",
            borderTop: "1px solid var(--border-color)",
            background: "var(--surface)",
            flexShrink: 0,
          }}
        >
          <Pagination
            size={isMobile ? "small" : undefined}
            current={currentPage}
            pageSize={pageSize}
            total={total}
            showSizeChanger={!isMobile}
            showQuickJumper={!isMobile}
            pageSizeOptions={[10, 20, 50, 100]}
            showTotal={(value, range) => `第 ${range[0]}-${range[1]} 条 / 共 ${value} 条`}
            onChange={(page, size) => {
              setCurrentPage(page);
              setPageSize(size);
            }}
          />
        </Flex>
      </Card>

      <Modal
        title="批量刷新账号"
        open={batchRefreshModalVisible}
        onCancel={() => setBatchRefreshModalVisible(false)}
        onOk={() => batchRefreshForm.submit()}
        confirmLoading={batchRefreshing}
        okText="开始刷新"
        cancelText="取消"
        width={isMobile ? "calc(100vw - 32px)" : 520}
        styles={{ body: { maxHeight: "calc(100dvh - 220px)", overflow: "auto" } }}
      >
        <Form
          form={batchRefreshForm}
          layout="vertical"
          initialValues={{ concurrency: 3 }}
          onFinish={handleBatchRefreshAccounts}
        >
          <Alert
            type="info"
            showIcon
            message={`将刷新 ${selectedRefreshableCount} 个账号`}
            description="刷新会登录账号获取最新空间列表，已有 workspace token 会复用，只补新增空间 token。"
            style={{ marginBottom: 16 }}
          />
          <Form.Item
            label="并发数"
            name="concurrency"
            rules={[{ required: true, message: "请输入并发数" }]}
          >
            <InputNumber min={1} max={10} precision={0} style={{ width: "100%" }} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="推送到 Sub2API"
        open={pushSub2apiModalVisible}
        onCancel={() => {
          if (!pushingSub2api) {
            setPushSub2apiModalVisible(false);
            setPushSub2apiTargetIds([]);
          }
        }}
        onOk={() => pushSub2apiForm.submit()}
        confirmLoading={pushingSub2api}
        okText="开始推送"
        cancelText="取消"
        width={isMobile ? "calc(100vw - 32px)" : 520}
        styles={{ body: { maxHeight: "calc(100dvh - 220px)", overflow: "auto" } }}
      >
        <Form
          form={pushSub2apiForm}
          layout="vertical"
          onFinish={handlePushSub2api}
        >
          <Alert
            type="info"
            showIcon
            message={`将推送已选 ${pushSub2apiTargetIds.length} 个账号`}
            description="会把账号里有效的 workspace token 上传到你选择的 Sub2API 站点和分组，并记录绑定状态。"
            style={{ marginBottom: 16 }}
          />
          <Form.Item
            label="Sub2API 站点"
            name="site_id"
            rules={[{ required: true, message: "请选择 Sub2API 站点" }]}
          >
            <Select
              placeholder="选择站点"
              loading={loadingSub2apiSites}
              options={sub2apiSites.map((site) => ({
                label: site.name,
                value: site.id,
              }))}
              onChange={async (siteId: number) => {
                pushSub2apiForm.setFieldValue("group_id", undefined);
                await loadSub2ApiGroups(siteId);
              }}
              showSearch
              optionFilterProp="label"
            />
          </Form.Item>
          <Form.Item
            label="目标分组"
            name="group_id"
            rules={[{ required: true, message: "请选择目标分组" }]}
          >
            <Select
              placeholder="选择分组"
              loading={loadingSub2apiGroups}
              disabled={!pushSub2apiForm.getFieldValue("site_id")}
              options={sub2apiGroups.map((group) => {
                const active = Number(group.active_account_count || 0);
                const limited = Number(group.rate_limited_account_count || 0);
                const available = Math.max(active - limited, 0);
                return {
                  label: `${group.name || `分组 ${group.id}`} #${group.id} · 可用 ${available}/${group.account_count || 0}`,
                  value: group.id,
                };
              })}
              showSearch
              optionFilterProp="label"
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={tokenModalAccount ? `Workspace Tokens · ${tokenModalAccount.email}` : "Workspace Tokens"}
        open={!!tokenModalAccount}
        onCancel={() => setTokenModalAccount(null)}
        footer={null}
        width={isMobile ? "calc(100vw - 32px)" : 860}
        styles={{ body: { maxHeight: "calc(100dvh - 180px)", overflow: "auto" } }}
      >
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          {getWorkspaceTokens(tokenModalAccount).map((workspace, index) => (
            <div
              key={`${workspace.workspace_id || index}-${index}`}
              style={{
                border: "1px solid #f0f0f0",
                borderRadius: 6,
                padding: 12,
                background: "#fff",
              }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: isMobile ? "minmax(0, 1fr)" : "minmax(280px, 1fr) minmax(360px, 420px)",
                  gap: 16,
                  alignItems: "center",
                }}
              >
                <Flex vertical gap={6} style={{ minWidth: 0 }}>
                  <Space wrap>
                    <Text strong>
                      {workspace.workspace_name || workspace.workspace_id || `Workspace ${index + 1}`}
                    </Text>
                    {workspace.plan_type && (
                      <Tag color={workspace.plan_type === "team" ? "green" : "gold"}>
                        {workspace.plan_type}
                      </Tag>
                    )}
                    {workspace.kind && <Tag>{workspace.kind}</Tag>}
                    {String(workspace.matched) === "true" && <Tag color="success">matched</Tag>}
                  </Space>
                  <Text type="secondary" copyable={{ text: workspace.workspace_id || "" }}>
                    {workspace.workspace_id || "-"}
                  </Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    过期时间: {formatExpiry(workspace.expires_at)}
                  </Text>
                </Flex>

                <Flex vertical gap={8}>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: isMobile ? "1fr 72px" : "84px 1fr 72px",
                      gap: 8,
                      alignItems: "center",
                    }}
                  >
                    {!isMobile && <Text>Access</Text>}
                    <Text code style={{ minWidth: 0 }}>
                      {maskToken(workspace.access_token)}
                    </Text>
                    <Button
                      size="small"
                      icon={<CopyOutlined />}
                      disabled={!workspace.access_token}
                      onClick={() => handleCopyToken(workspace.access_token || "", "Access Token")}
                    >
                      复制
                    </Button>
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: isMobile ? "1fr 72px" : "84px 1fr 72px",
                      gap: 8,
                      alignItems: "center",
                    }}
                  >
                    {!isMobile && <Text>Refresh</Text>}
                    <Text code style={{ minWidth: 0 }}>
                      {maskToken(workspace.refresh_token)}
                    </Text>
                    <Button
                      size="small"
                      icon={<CopyOutlined />}
                      disabled={!workspace.refresh_token}
                      onClick={() => handleCopyToken(workspace.refresh_token || "", "Refresh Token")}
                    >
                      复制
                    </Button>
                  </div>
                </Flex>
              </div>
            </div>
          ))}

          {getWorkspaceTokens(tokenModalAccount).length === 0 && (
            <Empty description="暂无 workspace tokens" />
          )}
        </Space>
      </Modal>

      <Modal
        title={teamMembersModal ? `Team 成员 · ${teamMembersModal.email}` : "Team 成员"}
        open={!!teamMembersModal}
        onCancel={() => setTeamMembersModal(null)}
        footer={null}
        width={isMobile ? "calc(100vw - 32px)" : 900}
        styles={{ body: { maxHeight: "calc(100dvh - 180px)", overflow: "auto" } }}
      >
        {teamMembersModal?.workspace ? (
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            <Flex justify="space-between" align="center" gap={12} wrap>
              <Flex vertical gap={4} style={{ minWidth: 0 }}>
                <Space wrap>
                  <Text strong>{teamMembersModal.workspace.workspace_name || teamMembersModal.workspace.workspace_id}</Text>
                  {teamMembersModal.workspace.plan_type && (
                    <Tag color={teamMembersModal.workspace.plan_type === "team" ? "green" : "default"}>
                      {teamMembersModal.workspace.plan_type}
                    </Tag>
                  )}
                  <Tag color={teamMembersModal.workspace.ok ? "success" : "error"}>
                    HTTP {teamMembersModal.workspace.status || 0}
                  </Tag>
                </Space>
                <Text type="secondary" copyable={{ text: teamMembersModal.team_workspace_id }}>
                  {teamMembersModal.team_workspace_id}
                </Text>
              </Flex>
              <Tag color="processing">
                共 {teamMembersModal.workspace.raw?.total ?? teamMembersModal.workspace.users?.length ?? 0} 个成员
              </Tag>
            </Flex>

            {teamMembersModal.workspace.error && (
              <Alert
                type="error"
                message={teamMembersModal.workspace.error}
                showIcon
              />
            )}

            <Table<TeamMember>
              size="small"
              rowKey={(record, index) => record.account_user_id || record.id || record.email || String(index)}
              pagination={false}
              dataSource={teamMembersModal.workspace.users || []}
              scroll={{ x: 760 }}
              columns={[
                {
                  title: "邮箱",
                  dataIndex: "email",
                  key: "email",
                  width: 260,
                  render: (email?: string) => email ? (
                    <Tooltip title={email}>
                      <Text copyable={{ text: email }} ellipsis style={{ maxWidth: 220 }}>
                        {email}
                      </Text>
                    </Tooltip>
                  ) : (
                    <Text type="secondary">-</Text>
                  ),
                },
                {
                  title: "名称",
                  dataIndex: "name",
                  key: "name",
                  width: 160,
                  render: (name?: string) => name || <Text type="secondary">-</Text>,
                },
                {
                  title: "角色",
                  dataIndex: "role",
                  key: "role",
                  width: 150,
                  render: (role?: string) => (
                    <Tag color={role === "account-owner" ? "gold" : "blue"}>
                      {role || "-"}
                    </Tag>
                  ),
                },
                {
                  title: "席位",
                  dataIndex: "seat_type",
                  key: "seat_type",
                  width: 110,
                  render: (seatType?: string) => seatType || <Text type="secondary">-</Text>,
                },
                {
                  title: "创建时间",
                  dataIndex: "created_time",
                  key: "created_time",
                  width: 190,
                  render: (createdTime?: string) => createdTime ? new Date(createdTime).toLocaleString() : "-",
                },
              ]}
              locale={{ emptyText: <Empty description="暂无成员数据" /> }}
            />
          </Space>
        ) : (
          <Empty description="暂无成员数据" />
        )}
      </Modal>

      <Modal
        title={inviteModalAccount ? `邀请加入 Team · ${inviteModalAccount.email}` : "邀请加入 Team"}
        open={!!inviteModalAccount}
        onCancel={() => {
          if (!inviting) {
            setInviteModalAccount(null);
            setInviteTargetIds([]);
          }
        }}
        footer={null}
        width={isMobile ? "calc(100vw - 32px)" : 640}
        styles={{ body: { maxHeight: "calc(100dvh - 180px)", overflow: "auto" } }}
      >
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Alert
            type="info"
            showIcon
            message="会自动发送邀请，并从被邀账号的 MoeMail 邮箱里提取邀请链接完成加入"
          />
          <Flex vertical gap={8}>
            <Flex align="center" justify="space-between" gap={12}>
              <Text type="secondary">
                当前成员：{inviteModalAccount?.team_member_count ?? "未查询"} / 5
              </Text>
              <Button
                type="primary"
                size="small"
                icon={<PlusOutlined />}
                onClick={handleInviteAccounts}
                loading={inviting}
                disabled={inviteTargetIds.length === 0}
              >
                发送并接受邀请
              </Button>
            </Flex>
            <Select
              mode="multiple"
              value={inviteTargetIds}
              onChange={setInviteTargetIds}
              placeholder="选择要邀请的账号"
              style={{ width: "100%" }}
              showSearch
              optionFilterProp="label"
              filterOption={(input, option) => (
                String(option?.label || "").toLowerCase().includes(input.trim().toLowerCase())
              )}
              maxCount={Math.max(1, 5 - (inviteModalAccount?.team_member_count ?? 1))}
              options={accounts
                .filter(account => account.id !== inviteModalAccount?.id)
                .map(account => ({
                  label: `${account.email}${account.email_service_id ? "" : " · 缺少 MoeMail ID"}`,
                  value: account.id,
                  disabled: !account.email_service_id,
                }))}
            />
          </Flex>
        </Space>
      </Modal>

      {/* 支付注册弹窗 */}
      <Modal
        title="支付注册"
        open={paymentModalVisible}
        onCancel={() => {
          setPaymentModalVisible(false);
          form.resetFields();
        }}
        onOk={() => form.submit()}
        confirmLoading={registering}
        okText="开始注册"
        cancelText="取消"
        width={isMobile ? "calc(100vw - 32px)" : 520}
        styles={{ body: { maxHeight: "calc(100dvh - 220px)", overflow: "auto" } }}
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{ count: 30, concurrency: 5 }}
          onFinish={handlePaymentRegistration}
        >
          <Form.Item
            label="注册数量"
            name="count"
            rules={[{ required: true, message: "请输入注册数量" }]}
          >
            <InputNumber min={1} max={50} precision={0} style={{ width: "100%" }} />
          </Form.Item>

          <Form.Item
            label="并发数"
            name="concurrency"
            tooltip="同时进行注册的任务数量"
          >
            <InputNumber min={1} max={5} precision={0} style={{ width: "100%" }} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 任务日志弹窗 */}
      <Modal
        title="任务日志"
        open={taskLogsVisible}
        onCancel={() => setTaskLogsVisible(false)}
        footer={null}
        width={isMobile ? "calc(100vw - 32px)" : 800}
        styles={{ body: { maxHeight: "calc(100dvh - 180px)", overflow: "auto" } }}
      >
        <Space direction="vertical" style={{ width: "100%", marginBottom: 12 }}>
          <Progress
            percent={taskSummary.percent}
            success={{ percent: taskSummary.successPercent }}
            status={taskSummary.failed > 0 ? "exception" : taskSummary.percent === 100 ? "success" : "active"}
          />
          <Space size={8} wrap>
            <Tag color="default">总数 {taskSummary.total}</Tag>
            <Tag color="success">成功 {taskSummary.success}</Tag>
            <Tag color="error">失败 {taskSummary.failed}</Tag>
            <Tag color="processing">进行中 {taskSummary.running}</Tag>
          </Space>
          <Select
            value={selectedTaskId || undefined}
            placeholder="选择任务"
            options={taskOptions}
            onChange={setSelectedTaskId}
            style={{ width: "100%" }}
          />
          {selectedTask && (
            <Text type="secondary">
              状态：{selectedTask.status}，进度：{selectedTask.progress || "0/0"}
            </Text>
          )}
        </Space>
        <div
          style={{
            maxHeight: isMobile ? "45dvh" : 500,
            overflow: "auto",
            backgroundColor: "#1e1e1e",
            color: "#d4d4d4",
            padding: 16,
            borderRadius: 4,
            fontFamily: "monospace",
            fontSize: 12,
            lineHeight: 1.6,
          }}
        >
          {selectedTaskLogs.length > 0 ? (
            <>
              {selectedTaskLogs.map((log, index) => (
                <div key={index} style={{ marginBottom: 4 }}>
                  {log}
                </div>
              ))}
              <div ref={taskLogsEndRef} />
            </>
          ) : (
            <div style={{ color: "#888" }}>暂无日志</div>
          )}
        </div>
      </Modal>
    </Flex>
  );
}
