"use client";

import { useState, useEffect } from "react";
import {
  Card,
  Table,
  Button,
  Space,
  Tag,
  Modal,
  Form,
  Input,
  Switch,
  Tooltip,
  Grid,
  message,
  Popconfirm,
} from "antd";
import {
  CopyOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { copyTextToClipboard } from "@/lib/clipboard";

interface Proxy {
  id: string;
  name: string;
  url: string;
  is_active: boolean;
  latency_ms?: number | null;
  success_count?: number;
  failure_count?: number;
  last_success_at?: string | null;
  last_failure_at?: string | null;
  last_checked_at?: string | null;
  last_error?: string | null;
  created_at: string;
}

interface ProxyFormValues {
  name?: string;
  url?: string;
  proxy_lines?: string;
  is_active?: boolean;
}

export default function ProxiesPage() {
  const [loading, setLoading] = useState(false);
  const [proxies, setProxies] = useState<Proxy[]>([]);
  const [proxyEnabled, setProxyEnabled] = useState(true);
  const [savingProxyEnabled, setSavingProxyEnabled] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingProxy, setEditingProxy] = useState<Proxy | null>(null);
  const [form] = Form.useForm<ProxyFormValues>();
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;
  const modalBodyStyle = { maxHeight: "min(72vh, 680px)", overflow: "auto" };
  const formGridStyle = {
    display: "grid",
    gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))",
    columnGap: 16,
  };

  const handleCopy = async (text: string) => {
    if (await copyTextToClipboard(text)) {
      message.success("已复制");
    } else {
      message.error("复制失败，请重试");
    }
  };

  const fetchProxies = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/proxies");
      const data = await res.json();
      setProxies(data.proxies || []);
      setProxyEnabled(data.proxy_enabled !== false);
    } catch {
      message.error("加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProxies();
  }, []);

  const handleAdd = () => {
    setEditingProxy(null);
    form.resetFields();
    setModalOpen(true);
  };

  const handleEdit = (record: Proxy) => {
    setEditingProxy(record);
    form.setFieldsValue({
      name: record.name,
      url: record.url,
      is_active: record.is_active,
    });
    setModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/proxies/${id}`, { method: "DELETE" });
      if (res.ok) {
        message.success("删除成功");
        fetchProxies();
      } else {
        message.error("删除失败");
      }
    } catch {
      message.error("删除失败");
    }
  };

  const handleToggleActive = async (id: string, currentActive: boolean) => {
    try {
      const res = await fetch(`/api/proxies/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !currentActive }),
      });

      if (res.ok) {
        message.success(currentActive ? "已停用" : "已启用");
        fetchProxies();
      } else {
        message.error("操作失败");
      }
    } catch {
      message.error("操作失败");
    }
  };

  const handleToggleProxyEnabled = async (checked: boolean) => {
    const previous = proxyEnabled;
    setProxyEnabled(checked);
    setSavingProxyEnabled(true);
    try {
      const res = await fetch("/api/proxies", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proxy_enabled: checked }),
      });

      if (res.ok) {
        message.success(checked ? "代理总开关已开启" : "代理总开关已关闭");
      } else {
        const data = await res.json().catch(() => ({}));
        setProxyEnabled(previous);
        message.error(data.error || "操作失败");
      }
    } catch {
      setProxyEnabled(previous);
      message.error("操作失败");
    } finally {
      setSavingProxyEnabled(false);
    }
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      const url = editingProxy
        ? `/api/proxies/${editingProxy.id}`
        : "/api/proxies";
      const method = editingProxy ? "PUT" : "POST";
      const payload = editingProxy
        ? values
        : {
            urls: String(values.proxy_lines || "")
              .split(/\r?\n/)
              .map((item) => item.trim())
              .filter(Boolean),
          };

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        if (editingProxy) {
          message.success("更新成功");
        } else {
          const createdCount = data.created_count ?? data.proxies?.length ?? 0;
          const skippedCount = data.skipped_count ?? 0;
          message.success(`添加成功：新增 ${createdCount} 条${skippedCount ? `，跳过重复 ${skippedCount} 条` : ""}`);
        }
        setModalOpen(false);
        fetchProxies();
      } else {
        const data = await res.json().catch(() => ({}));
        message.error(data.error || "操作失败");
      }
    } catch {
      message.error("操作失败");
    }
  };

  const columns: ColumnsType<Proxy> = [
    {
      title: "名称",
      dataIndex: "name",
      key: "name",
      width: 160,
    },
    {
      title: "代理地址",
      dataIndex: "url",
      key: "url",
      width: 320,
      ellipsis: true,
      render: (url: string) => (
        <Space size={4} style={{ maxWidth: "100%" }}>
          <Tooltip title={url}>
            <span style={{ display: "inline-block", maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {url}
            </span>
          </Tooltip>
          <Tooltip title="复制代理地址">
            <Button
              size="small"
              type="text"
              icon={<CopyOutlined />}
              onClick={() => handleCopy(url)}
            />
          </Tooltip>
        </Space>
      ),
    },
    {
      title: "状态",
      dataIndex: "is_active",
      key: "is_active",
      width: 90,
      render: (isActive: boolean, record) => (
        <Switch
          checked={isActive}
          onChange={() => handleToggleActive(record.id, isActive)}
        />
      ),
    },
    {
      title: "网络",
      key: "health",
      width: 220,
      render: (_, record) => {
        const checked = !!record.last_checked_at;
        const failed = !!record.last_error;
        return (
          <Space direction="vertical" size={2}>
            <Space size={6}>
              <Tag color={!checked ? "default" : failed ? "error" : "success"}>
                {!checked ? "未检测" : failed ? "异常" : "可用"}
              </Tag>
              {record.latency_ms !== null && record.latency_ms !== undefined && (
                <Tag color={record.latency_ms <= 3000 ? "processing" : "warning"}>
                  {record.latency_ms}ms
                </Tag>
              )}
            </Space>
            <span style={{ fontSize: 12, color: "#8c8c8c" }}>
              成功 {record.success_count || 0} / 失败 {record.failure_count || 0}
            </span>
            {record.last_error && (
              <Tooltip title={record.last_error}>
                <span style={{ display: "inline-block", maxWidth: 190, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, color: "#ff4d4f" }}>
                  {record.last_error}
                </span>
              </Tooltip>
            )}
          </Space>
        );
      },
    },
    {
      title: "创建时间",
      dataIndex: "created_at",
      key: "created_at",
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
          <Popconfirm
            title="确定删除？"
            onConfirm={() => handleDelete(record.id)}
          >
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

  return (
    <Card
      className="arm-table-card"
      title="代理配置"
      extra={
        <Space className="arm-card-actions" wrap>
          <Space size={8}>
            <span style={{ color: "#595959" }}>总开关</span>
            <Switch
              checked={proxyEnabled}
              loading={savingProxyEnabled}
              checkedChildren="走代理"
              unCheckedChildren="直连"
              onChange={handleToggleProxyEnabled}
            />
          </Space>
          <Button icon={<ReloadOutlined />} onClick={fetchProxies}>
            刷新
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
            添加代理
          </Button>
        </Space>
      }
    >
      <Table
        columns={columns}
        dataSource={proxies}
        loading={loading}
        rowKey="id"
        scroll={{ x: 1140 }}
      />

      <Modal
        title={editingProxy ? "编辑代理" : "添加代理"}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSubmit}
        width={isMobile ? "calc(100vw - 32px)" : 720}
        styles={{ body: modalBodyStyle }}
      >
        <Form form={form} layout="vertical" style={formGridStyle}>
          {editingProxy ? (
            <>
              <Form.Item
                label="名称"
                name="name"
                rules={[{ required: true, message: "请输入名称" }]}
              >
                <Input placeholder="例: 主代理" />
              </Form.Item>

              <Form.Item
                label="代理地址"
                name="url"
                rules={[{ required: true, message: "请输入代理地址" }]}
                style={{ gridColumn: "1 / -1" }}
              >
                <Input placeholder="http://127.0.0.1:7890 或 socks5://127.0.0.1:1080" />
              </Form.Item>

              <Form.Item
                label="启用"
                name="is_active"
                valuePropName="checked"
                initialValue={true}
              >
                <Switch />
              </Form.Item>
            </>
          ) : (
            <Form.Item
              label="代理列表"
              name="proxy_lines"
              rules={[{ required: true, message: "请输入代理地址，一行一条" }]}
              extra="一行一条，未写协议时会自动按 http:// 保存。"
              style={{ gridColumn: "1 / -1" }}
            >
              <Input.TextArea
                rows={10}
                placeholder={"7931431-ac2c17f0:ea3b9ce4-DE-29472978-5m@gate.kookeey.info:1000"}
              />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </Card>
  );
}
