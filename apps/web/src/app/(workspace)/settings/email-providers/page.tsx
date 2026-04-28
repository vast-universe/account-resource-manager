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
  Select,
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

interface EmailProvider {
  id: string;
  public_id: string;
  provider_type: string;
  name: string;
  description: string;
  api_url: string;
  status: "active" | "inactive" | "error";
  is_default: boolean;
  health_check_status?: "healthy" | "degraded" | "down";
  total_mailboxes_created: number;
  last_used_at?: string;
  created_at: string;
}

export default function EmailProvidersPage() {
  const [loading, setLoading] = useState(false);
  const [providers, setProviders] = useState<EmailProvider[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<EmailProvider | null>(null);
  const [form] = Form.useForm();
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

  const fetchProviders = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/email-providers");
      const data = await res.json();
      setProviders(data.providers || []);
    } catch {
      message.error("加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProviders();
  }, []);

  const handleAdd = () => {
    setEditingProvider(null);
    form.resetFields();
    setModalOpen(true);
  };

  const handleEdit = (record: EmailProvider) => {
    setEditingProvider(record);
    form.setFieldsValue({
      provider_type: record.provider_type,
      name: record.name,
      description: record.description,
      api_url: record.api_url,
      is_default: record.is_default,
      status: record.status,
    });
    setModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/email-providers/${id}`, { method: "DELETE" });
      if (res.ok) {
        message.success("删除成功");
        fetchProviders();
      } else {
        message.error("删除失败");
      }
    } catch {
      message.error("删除失败");
    }
  };

  const handleToggleDefault = async (id: string, currentDefault: boolean) => {
    try {
      const res = await fetch(`/api/email-providers/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_default: !currentDefault }),
      });

      if (res.ok) {
        message.success(currentDefault ? "已取消默认" : "已设为默认");
        fetchProviders();
      } else {
        message.error("操作失败");
      }
    } catch {
      message.error("操作失败");
    }
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      const url = editingProvider
        ? `/api/email-providers/${editingProvider.id}`
        : "/api/email-providers";
      const method = editingProvider ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });

      if (res.ok) {
        message.success(editingProvider ? "更新成功" : "添加成功");
        setModalOpen(false);
        fetchProviders();
      } else {
        message.error("操作失败");
      }
    } catch {
      message.error("操作失败");
    }
  };

  const columns: ColumnsType<EmailProvider> = [
    {
      title: "提供商",
      dataIndex: "provider_type",
      key: "provider_type",
      width: 120,
      render: (type: string) => {
        const typeMap: Record<string, { label: string; color: string }> = {
          moemail: { label: "MoeMail", color: "blue" },
          duckmail: { label: "DuckMail", color: "green" },
          mailcow: { label: "Mailcow", color: "orange" },
          mailtm: { label: "Mail.tm", color: "purple" },
        };
        const config = typeMap[type] || { label: type, color: "default" };
        return <Tag color={config.color}>{config.label}</Tag>;
      },
    },
    {
      title: "名称",
      dataIndex: "name",
      key: "name",
      width: 160,
    },
    {
      title: "API URL",
      dataIndex: "api_url",
      key: "api_url",
      width: 280,
      ellipsis: true,
      render: (url: string) => (
        <Space size={4} style={{ maxWidth: "100%" }}>
          <Tooltip title={url}>
            <span style={{ display: "inline-block", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {url}
            </span>
          </Tooltip>
          <Tooltip title="复制 API URL">
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
      dataIndex: "status",
      key: "status",
      width: 100,
      render: (status: string) => {
        const statusMap: Record<string, { label: string; color: string }> = {
          active: { label: "启用", color: "success" },
          inactive: { label: "停用", color: "default" },
          error: { label: "错误", color: "error" },
        };
        const config = statusMap[status] || { label: status, color: "default" };
        return <Tag color={config.color}>{config.label}</Tag>;
      },
    },
    {
      title: "默认",
      dataIndex: "is_default",
      key: "is_default",
      width: 90,
      render: (isDefault: boolean, record) => (
        <Switch
          checked={isDefault}
          onChange={() => handleToggleDefault(record.id, isDefault)}
        />
      ),
    },
    {
      title: "已创建邮箱",
      dataIndex: "total_mailboxes_created",
      key: "total_mailboxes_created",
      width: 120,
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
      title="邮箱服务提供商配置"
      extra={
        <Space className="arm-card-actions" wrap>
          <Button icon={<ReloadOutlined />} onClick={fetchProviders}>
            刷新
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
            添加提供商
          </Button>
        </Space>
      }
    >
      <Table
        columns={columns}
        dataSource={providers}
        loading={loading}
        rowKey="id"
        scroll={{ x: 1030 }}
      />

      <Modal
        title={editingProvider ? "编辑提供商" : "添加提供商"}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSubmit}
        width={isMobile ? "calc(100vw - 32px)" : 720}
        styles={{ body: modalBodyStyle }}
      >
        <Form form={form} layout="vertical" style={formGridStyle}>
          <Form.Item
            label="提供商类型"
            name="provider_type"
            rules={[{ required: true, message: "请选择提供商类型" }]}
          >
            <Select
              options={[
                { label: "MoeMail", value: "moemail" },
                { label: "DuckMail", value: "duckmail" },
                { label: "Mailcow", value: "mailcow" },
                { label: "Mail.tm", value: "mailtm" },
              ]}
            />
          </Form.Item>

          <Form.Item
            label="名称"
            name="name"
            rules={[{ required: true, message: "请输入名称" }]}
          >
            <Input placeholder="例: MoeMail 主服务" />
          </Form.Item>

          <Form.Item label="描述" name="description" style={{ gridColumn: "1 / -1" }}>
            <Input.TextArea rows={2} placeholder="可选的描述信息" />
          </Form.Item>

          <Form.Item
            label="API URL"
            name="api_url"
            rules={[{ required: true, message: "请输入 API URL" }]}
            style={{ gridColumn: "1 / -1" }}
          >
            <Input placeholder="https://moemail-4gj.pages.dev" />
          </Form.Item>

          <Form.Item
            label="API Key"
            name="api_key"
            rules={[{ required: !editingProvider, message: "请输入 API Key" }]}
          >
            <Input.Password placeholder={editingProvider ? "留空则不修改" : "输入 API Key"} />
          </Form.Item>

          <Form.Item label="状态" name="status" initialValue="active">
            <Select
              options={[
                { label: "启用", value: "active" },
                { label: "停用", value: "inactive" },
              ]}
            />
          </Form.Item>

          <Form.Item
            label="设为默认"
            name="is_default"
            valuePropName="checked"
            initialValue={false}
          >
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
