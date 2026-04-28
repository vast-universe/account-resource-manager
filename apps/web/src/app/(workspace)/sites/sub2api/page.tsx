"use client";

import { useEffect, useState } from "react";
import {
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  Grid,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
} from "@ant-design/icons";

interface Sub2ApiSite {
  id: string;
  public_id: string;
  name: string;
  api_url: string;
  api_key_masked: string;
  status: "active" | "inactive";
  notes: string;
  created_at: string;
  updated_at: string;
}

interface SiteFormValues {
  name: string;
  api_url: string;
  api_key?: string;
  is_active: boolean;
  notes?: string;
}

interface Sub2ApiGroup {
  id: number;
  name: string;
  description?: string;
  platform?: string;
  status?: string;
  is_exclusive?: boolean;
  account_count?: number;
  active_account_count?: number;
  rate_limited_account_count?: number;
  rate_multiplier?: number;
  threshold_available?: number;
  last_checked_at?: string;
}

export default function Sub2ApiSitesPage() {
  const [loading, setLoading] = useState(false);
  const [sites, setSites] = useState<Sub2ApiSite[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [expandedRowKeys, setExpandedRowKeys] = useState<string[]>([]);
  const [groupsBySite, setGroupsBySite] = useState<Record<string, Sub2ApiGroup[]>>({});
  const [groupsLoadingBySite, setGroupsLoadingBySite] = useState<Record<string, boolean>>({});
  const [savingThresholdKeys, setSavingThresholdKeys] = useState<Set<string>>(new Set());
  const [runningMonitorKeys, setRunningMonitorKeys] = useState<Set<string>>(new Set());
  const [editingSite, setEditingSite] = useState<Sub2ApiSite | null>(null);
  const [form] = Form.useForm<SiteFormValues>();
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;
  const modalBodyStyle = { maxHeight: "min(72vh, 680px)", overflow: "auto" };
  const formGridStyle = {
    display: "grid",
    gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))",
    columnGap: 16,
  };

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      message.success("已复制");
    } catch {
      message.error("复制失败");
    }
  };

  const fetchSites = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/sub2api-sites");
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "加载失败");
      }
      setSites(data.sites || []);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSites();
  }, []);

  const handleAdd = () => {
    setEditingSite(null);
    form.resetFields();
    form.setFieldsValue({ is_active: true });
    setModalOpen(true);
  };

  const handleEdit = (record: Sub2ApiSite) => {
    setEditingSite(record);
    form.setFieldsValue({
      name: record.name,
      api_url: record.api_url,
      api_key: "",
      is_active: record.status === "active",
      notes: record.notes,
    });
    setModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/sub2api-sites/${id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "删除失败");
      }
      message.success("删除成功");
      fetchSites();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "删除失败");
    }
  };

  const handleToggleActive = async (record: Sub2ApiSite) => {
    try {
      const res = await fetch(`/api/sub2api-sites/${record.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: record.status === "active" ? "inactive" : "active" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "操作失败");
      }
      message.success(record.status === "active" ? "已停用" : "已启用");
      fetchSites();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "操作失败");
    }
  };

  const fetchGroupsForSite = async (record: Sub2ApiSite) => {
    setGroupsLoadingBySite((current) => ({ ...current, [record.id]: true }));
    try {
      const res = await fetch(`/api/sub2api-sites/${record.id}/groups`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "查询分组失败");
      }
      setGroupsBySite((current) => ({ ...current, [record.id]: data.groups || [] }));
    } catch (error) {
      message.error(error instanceof Error ? error.message : "查询分组失败");
    } finally {
      setGroupsLoadingBySite((current) => ({ ...current, [record.id]: false }));
    }
  };

  const handleExpand = (expanded: boolean, record: Sub2ApiSite) => {
    setExpandedRowKeys((current) =>
      expanded ? Array.from(new Set([...current, record.id])) : current.filter((id) => id !== record.id)
    );
    if (expanded && !groupsBySite[record.id]) {
      fetchGroupsForSite(record);
    }
  };

  const updateLocalGroupThreshold = (siteId: string, groupId: number, threshold: number) => {
    setGroupsBySite((current) => ({
      ...current,
      [siteId]: (current[siteId] || []).map((group) =>
        Number(group.id) === Number(groupId)
          ? { ...group, threshold_available: threshold }
          : group
      ),
    }));
  };

  const handleSaveThreshold = async (site: Sub2ApiSite, group: Sub2ApiGroup) => {
    const key = `${site.id}:${group.id}`;
    setSavingThresholdKeys((current) => new Set([...current, key]));
    try {
      const res = await fetch(`/api/sub2api-sites/${site.id}/groups/${group.id}/threshold`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threshold_available: group.threshold_available || 0 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "保存阈值失败");
      }
      message.success("阈值已保存");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "保存阈值失败");
    } finally {
      setSavingThresholdKeys((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  };

  const handleRunMonitor = async (site: Sub2ApiSite, group: Sub2ApiGroup) => {
    const key = `${site.id}:${group.id}`;
    setRunningMonitorKeys((current) => new Set([...current, key]));
    try {
      const res = await fetch("/api/sub2api-monitor/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ site_id: Number(site.id), group_id: Number(group.id) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "检查补号失败");
      }
      const result = data.results?.[0];
      const accountCount = Number(result?.candidate_account_count || 0);
      const tokenCount = Number(result?.uploaded || 0);
      message.success(`检查完成，分配 ${accountCount} 个账号，上传 ${tokenCount} 个 token`);
      fetchGroupsForSite(site);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "检查补号失败");
    } finally {
      setRunningMonitorKeys((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      const payload: Partial<Omit<SiteFormValues, "is_active">> & {
        status: "active" | "inactive";
      } = {
        name: values.name,
        api_url: values.api_url,
        api_key: values.api_key,
        notes: values.notes,
        status: values.is_active ? "active" : "inactive",
      };
      if (editingSite && !String(payload.api_key || "").trim()) {
        delete payload.api_key;
      }

      const res = await fetch(
        editingSite ? `/api/sub2api-sites/${editingSite.id}` : "/api/sub2api-sites",
        {
          method: editingSite ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "操作失败");
      }

      message.success(editingSite ? "更新成功" : "添加成功");
      setModalOpen(false);
      fetchSites();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "操作失败");
    }
  };

  const columns: ColumnsType<Sub2ApiSite> = [
    {
      title: "站点",
      dataIndex: "name",
      key: "name",
      width: 240,
      render: (name: string, record) => (
        <Space direction="vertical" size={2}>
          <span>{name}</span>
          {record.notes ? (
            <Tooltip title={record.notes}>
              <span style={{ display: "inline-block", maxWidth: 210, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#8c8c8c", fontSize: 12 }}>
                {record.notes}
              </span>
            </Tooltip>
          ) : null}
        </Space>
      ),
    },
    {
      title: "API URL",
      dataIndex: "api_url",
      key: "api_url",
      width: 320,
      ellipsis: true,
      render: (url: string) => (
        <Space size={4} style={{ maxWidth: "100%" }}>
          <Tooltip title={url}>
            <span style={{ display: "inline-block", maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {url}
            </span>
          </Tooltip>
          <Tooltip title="复制 API URL">
            <Button size="small" type="text" icon={<CopyOutlined />} onClick={() => handleCopy(url)} />
          </Tooltip>
        </Space>
      ),
    },
    {
      title: "启用",
      dataIndex: "status",
      key: "status",
      width: 100,
      render: (status: string, record) => (
        <Switch checked={status === "active"} onChange={() => handleToggleActive(record)} />
      ),
    },
    {
      title: "更新时间",
      dataIndex: "updated_at",
      key: "updated_at",
      width: 190,
      render: (date: string) => new Date(date).toLocaleString(),
    },
    {
      title: "操作",
      key: "action",
      width: 160,
      fixed: "right",
      render: (_, record) => (
        <Space wrap style={{ width: "100%" }}>
          <Button
            size="small"
            type="link"
            icon={<EditOutlined />}
            style={{ width: isMobile ? "100%" : undefined }}
            onClick={() => handleEdit(record)}
          >
            编辑
          </Button>
          <Popconfirm title="确定删除？" onConfirm={() => handleDelete(record.id)}>
            <Button
              size="small"
              type="link"
              danger
              icon={<DeleteOutlined />}
              style={{ width: isMobile ? "100%" : undefined }}
            >
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const groupColumns = (site: Sub2ApiSite): ColumnsType<Sub2ApiGroup> => [
    { title: "ID", dataIndex: "id", key: "id", width: 80 },
    {
      title: "分组",
      dataIndex: "name",
      key: "name",
      width: 260,
      render: (name: string, record) => (
        <Space direction="vertical" size={2}>
          <span>{name}</span>
          {record.description ? (
            <Tooltip title={record.description}>
              <span style={{ display: "inline-block", maxWidth: 230, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#8c8c8c", fontSize: 12 }}>
                {record.description}
              </span>
            </Tooltip>
          ) : null}
        </Space>
      ),
    },
    {
      title: "账号数量",
      key: "account_count",
      width: 320,
      render: (_, record) => {
        const activeCount = record.active_account_count ?? 0;
        const rateLimitedCount = record.rate_limited_account_count ?? 0;
        const availableCount = Math.max(activeCount - rateLimitedCount, 0);

        return (
          <Space size={4} wrap>
            <Tag color="blue">总数 {record.account_count ?? 0}</Tag>
            <Tag color="success">可用 {availableCount}</Tag>
            <Tag color="warning">限速 {rateLimitedCount}</Tag>
          </Space>
        );
      },
    },
    {
      title: "可用阈值",
      key: "threshold_available",
      width: 190,
      render: (_, group) => {
        const key = `${site.id}:${group.id}`;
        return (
          <Space size={6}>
            <InputNumber
              min={0}
              precision={0}
              value={group.threshold_available || 0}
              onChange={(value) => updateLocalGroupThreshold(site.id, group.id, Number(value || 0))}
              style={{ width: 90 }}
            />
            <Button
              size="small"
              loading={savingThresholdKeys.has(key)}
              onClick={() => handleSaveThreshold(site, group)}
            >
              保存
            </Button>
          </Space>
        );
      },
    },
    { title: "平台", dataIndex: "platform", key: "platform", width: 110 },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      width: 100,
      render: (status: string) => (
        <Tag color={status === "active" ? "success" : "default"}>{status || "unknown"}</Tag>
      ),
    },
    {
      title: "类型",
      dataIndex: "is_exclusive",
      key: "is_exclusive",
      width: 100,
      render: (exclusive: boolean) => (
        <Tag color={exclusive ? "warning" : "processing"}>{exclusive ? "专属" : "公共"}</Tag>
      ),
    },
    {
      title: "倍率",
      dataIndex: "rate_multiplier",
      key: "rate_multiplier",
      width: 90,
      render: (value: number) => value ?? 1,
    },
    {
      title: "操作",
      key: "actions",
      width: 120,
      fixed: "right",
      render: (_, group) => {
        const key = `${site.id}:${group.id}`;
        return (
          <Button
            size="small"
            type="link"
            loading={runningMonitorKeys.has(key)}
            onClick={() => handleRunMonitor(site, group)}
          >
            检查补号
          </Button>
        );
      },
    },
  ];

  const renderExpandedGroups = (record: Sub2ApiSite) => {
    const groups = groupsBySite[record.id] || [];

    return (
      <Space direction="vertical" size={12} style={{ width: "100%" }}>
        <Space wrap>
          <Button
            size="small"
            icon={<ReloadOutlined />}
            loading={groupsLoadingBySite[record.id]}
            onClick={() => fetchGroupsForSite(record)}
          >
            刷新分组
          </Button>
        </Space>
        {isMobile ? (
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            {groups.map((group) => {
              const key = `${record.id}:${group.id}`;
              const activeCount = group.active_account_count ?? 0;
              const rateLimitedCount = group.rate_limited_account_count ?? 0;
              const availableCount = Math.max(activeCount - rateLimitedCount, 0);

              return (
                <Card key={group.id} size="small" title={group.name} extra={<Tag>{group.id}</Tag>}>
                  <Space direction="vertical" size={10} style={{ width: "100%" }}>
                    {group.description ? (
                      <Tooltip title={group.description}>
                        <span style={{ color: "#8c8c8c" }}>{group.description}</span>
                      </Tooltip>
                    ) : null}
                    <Space size={4} wrap>
                      <Tag color="blue">总数 {group.account_count ?? 0}</Tag>
                      <Tag color="success">可用 {availableCount}</Tag>
                      <Tag color="warning">限速 {rateLimitedCount}</Tag>
                      <Tag color={group.is_exclusive ? "warning" : "processing"}>
                        {group.is_exclusive ? "专属" : "公共"}
                      </Tag>
                      <Tag color={group.status === "active" ? "success" : "default"}>{group.status || "unknown"}</Tag>
                    </Space>
                    <Space.Compact style={{ width: "100%" }}>
                      <InputNumber
                        min={0}
                        precision={0}
                        value={group.threshold_available || 0}
                        onChange={(value) => updateLocalGroupThreshold(record.id, group.id, Number(value || 0))}
                        style={{ width: "100%" }}
                      />
                      <Button loading={savingThresholdKeys.has(key)} onClick={() => handleSaveThreshold(record, group)}>
                        保存阈值
                      </Button>
                    </Space.Compact>
                    <Button
                      block
                      type="primary"
                      ghost
                      loading={runningMonitorKeys.has(key)}
                      onClick={() => handleRunMonitor(record, group)}
                    >
                      检查补号
                    </Button>
                  </Space>
                </Card>
              );
            })}
          </Space>
        ) : (
          <Table
            size="small"
            rowKey="id"
            loading={groupsLoadingBySite[record.id]}
            dataSource={groups}
            columns={groupColumns(record)}
            pagination={false}
            scroll={{ x: 1180 }}
          />
        )}
      </Space>
    );
  };

  return (
    <Card
      className="arm-table-card"
      title="Sub2API 站点"
      extra={
        <Space className="arm-card-actions" wrap>
          <Button icon={<ReloadOutlined />} onClick={fetchSites}>
            刷新
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
            添加站点
          </Button>
        </Space>
      }
    >
      <Table
        columns={columns}
        dataSource={sites}
        loading={loading}
        rowKey="id"
        scroll={{ x: 1010 }}
        expandable={{
          expandedRowKeys,
          onExpand: handleExpand,
          expandedRowRender: renderExpandedGroups,
        }}
      />

      <Modal
        title={editingSite ? "编辑 Sub2API 站点" : "添加 Sub2API 站点"}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSubmit}
        width={isMobile ? "calc(100vw - 32px)" : 760}
        styles={{ body: modalBodyStyle }}
      >
        <Form form={form} layout="vertical" style={formGridStyle}>
          <Form.Item
            label="站点名称"
            name="name"
            rules={[{ required: true, message: "请输入站点名称" }]}
          >
            <Input placeholder="例: 主 Sub2API" />
          </Form.Item>

          <Form.Item
            label="API URL"
            name="api_url"
            rules={[{ required: true, message: "请输入 API URL" }]}
            style={{ gridColumn: "1 / -1" }}
          >
            <Input placeholder="https://sub2api.example.com" />
          </Form.Item>

          <Form.Item
            label="管理员 API Key"
            name="api_key"
            rules={[{ required: !editingSite, message: "请输入管理员 API Key" }]}
            extra={editingSite ? "留空则不修改当前 API Key。" : undefined}
          >
            <Input.Password placeholder={editingSite ? "留空则不修改" : "admin-..."} />
          </Form.Item>

          <Form.Item
            label="启用"
            name="is_active"
            valuePropName="checked"
            initialValue={true}
          >
            <Switch checkedChildren="启用" unCheckedChildren="停用" />
          </Form.Item>

          <Form.Item label="备注" name="notes" style={{ gridColumn: "1 / -1" }}>
            <Input.TextArea rows={3} placeholder="可选，例如用途、地区、负责人" />
          </Form.Item>
        </Form>
      </Modal>

    </Card>
  );
}
