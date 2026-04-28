"use client";

import { useState } from "react";
import { App, Button, Card, Checkbox, Flex, Form, Input, Space, theme } from "antd";
import { LockOutlined, MailOutlined, SafetyCertificateOutlined } from "@ant-design/icons";
import { ThemeToggleButton } from "@/components/theme-toggle-button";
import Paragraph from "antd/es/typography/Paragraph";
import Text from "antd/es/typography/Text";
import Title from "antd/es/typography/Title";

type SignInFormValues = {
  email: string;
  password: string;
  rememberMe: boolean;
};

export function SignInPage() {
  const [form] = Form.useForm<SignInFormValues>();
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(values: SignInFormValues) {
    try {
      setSubmitting(true);

      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(values),
      });

      const payload = (await response.json().catch(() => null)) as
        | {
            message?: string;
            redirectTo?: string;
          }
        | null;

      if (!response.ok) {
        message.error(payload?.message || "登录失败，请重试");
        return;
      }

      window.location.replace(payload?.redirectTo || "/dashboard");
    } catch {
      message.error("登录请求失败，请检查网络后重试");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Flex
      align="center"
      justify="center"
      style={{
        position: "relative",
        minHeight: "100vh",
        padding: 24,
        background: "var(--hero-background)",
      }}
    >
      <Flex style={{ position: "absolute", top: 24, right: 24, zIndex: 2 }}>
        <ThemeToggleButton />
      </Flex>

      <Card
        variant="borderless"
        style={{
          width: "100%",
          maxWidth: 1080,
          overflow: "hidden",
          background: "var(--surface)",
          border: `1px solid ${token.colorBorder}`,
          boxShadow: "var(--shadow-panel)",
        }}
        styles={{ body: { padding: 0 } }}
      >
        <Flex vertical={false} wrap="wrap">
          <Flex
            vertical
            justify="space-between"
            style={{
              flex: "1 1 420px",
              minHeight: 640,
              padding: 40,
              background: "var(--hero-panel)",
              color: "#ffffff",
            }}
          >
            <Space orientation="vertical" size={20}>
              <Flex
                align="center"
                justify="center"
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 16,
                  background: "rgba(255, 255, 255, 0.16)",
                }}
              >
                <SafetyCertificateOutlined style={{ fontSize: 20 }} />
              </Flex>
              <Space orientation="vertical" size={8}>
                <Title level={2} style={{ margin: 0, color: "#ffffff" }}>
                  Account Resource Manager
                </Title>
                <Paragraph
                  style={{
                    margin: 0,
                    color: "rgba(255, 255, 255, 0.82)",
                    maxWidth: 360,
                  }}
                >
                  使用授权账号安全访问仪表盘与资源管理工作区。
                </Paragraph>
              </Space>
            </Space>

            <Space orientation="vertical" size={12}>
              <Text style={{ color: "rgba(255, 255, 255, 0.72)" }}>安全访问</Text>
              <Title level={3} style={{ margin: 0, color: "#ffffff" }}>
                登录系统
              </Title>
              <Paragraph style={{ margin: 0, color: "rgba(255, 255, 255, 0.82)" }}>
                通过受控凭据进入后台工作区。
              </Paragraph>
            </Space>
          </Flex>

          <Flex
            vertical
            justify="center"
            style={{
              flex: "1 1 420px",
              minHeight: 640,
              padding: 40,
              background: "var(--surface)",
            }}
          >
            <Space orientation="vertical" size={8} style={{ marginBottom: 32 }}>
              <Text type="secondary">欢迎回来</Text>
              <Title level={2} style={{ margin: 0 }}>
                登录
              </Title>
              <Paragraph type="secondary" style={{ margin: 0 }}>
                输入账号信息以继续访问系统。
              </Paragraph>
            </Space>

            <Form<SignInFormValues>
              form={form}
              layout="vertical"
              size="large"
              initialValues={{ rememberMe: true }}
              onFinish={(values) => void handleSubmit(values)}
            >
              <Form.Item
                label="邮箱"
                name="email"
                rules={[
                  { required: true, message: "请输入邮箱地址" },
                  { type: "email", message: "请输入合法的邮箱地址" },
                ]}
              >
                <Input prefix={<MailOutlined />} placeholder="请输入邮箱地址" />
              </Form.Item>

              <Form.Item
                label="密码"
                name="password"
                rules={[{ required: true, message: "请输入密码" }]}
              >
                <Input.Password prefix={<LockOutlined />} placeholder="请输入密码" />
              </Form.Item>

              <Flex justify="space-between" align="center" style={{ marginBottom: 24 }}>
                <Form.Item name="rememberMe" valuePropName="checked" noStyle>
                  <Checkbox>记住登录状态</Checkbox>
                </Form.Item>
                <Text type="secondary">受保护访问</Text>
              </Flex>

              <Button type="primary" block size="large" htmlType="submit" loading={submitting}>
                登录并进入系统
              </Button>
            </Form>
          </Flex>
        </Flex>
      </Card>
    </Flex>
  );
}
