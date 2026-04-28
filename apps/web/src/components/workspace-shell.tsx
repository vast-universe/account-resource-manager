"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  DownOutlined,
  BellOutlined,
  FolderOpenOutlined,
  HomeOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuOutlined,
  MenuUnfoldOutlined,
  UserOutlined,
  RobotOutlined,
  SettingOutlined,
  ApiOutlined,
  InboxOutlined,
  CloudServerOutlined,
} from "@ant-design/icons";
import {
  App,
  Avatar,
  Badge,
  Button,
  Drawer,
  Dropdown,
  Flex,
  Layout,
  Menu,
  Space,
  Tooltip,
  theme,
} from "antd";
import type { MenuProps } from "antd";
import { Content, Header } from "antd/es/layout/layout";
import Sider from "antd/es/layout/Sider";
import { ThemeToggleButton } from "@/components/theme-toggle-button";
import Text from "antd/es/typography/Text";

type NavigationLeaf = {
  icon?: ReactNode;
  key: string;
  label: string;
  path: string;
};

type NavigationGroup = {
  children: NavigationLeaf[];
  icon: ReactNode;
  key: string;
  label: string;
};

type NavigationEntry = NavigationGroup | NavigationLeaf;

const DESKTOP_SIDER_WIDTH = 248;
const DESKTOP_SIDER_COLLAPSED_WIDTH = 88;
const SHELL_SIDER_Z_INDEX = 50;
const SHELL_HEADER_Z_INDEX = 100;
const SHELL_DRAWER_Z_INDEX = 1400;

const navigationEntries: NavigationEntry[] = [
  {
    key: "dashboard",
    icon: <HomeOutlined />,
    label: "仪表盘",
    path: "/dashboard",
  },
  {
    key: "resources",
    icon: <FolderOpenOutlined />,
    label: "资源中心",
    children: [
      {
        key: "resources-moemail",
        icon: <InboxOutlined />,
        label: "MoeMail 邮箱",
        path: "/resources/moemail",
      },
      {
        key: "resources-chatgpt",
        icon: <RobotOutlined />,
        label: "ChatGPT 账号",
        path: "/resources/chatgpt",
      },
    ],
  },
  {
    key: "site-management",
    icon: <CloudServerOutlined />,
    label: "站点管理",
    children: [
      {
        key: "site-management-sub2api",
        icon: <ApiOutlined />,
        label: "Sub2API 站点",
        path: "/sites/sub2api",
      },
    ],
  },
  {
    key: "settings",
    icon: <SettingOutlined />,
    label: "系统设置",
    children: [
      {
        key: "settings-email-providers",
        icon: <ApiOutlined />,
        label: "邮箱服务配置",
        path: "/settings/email-providers",
      },
      {
        key: "settings-proxies",
        icon: <ApiOutlined />,
        label: "代理配置",
        path: "/settings/proxies",
      },
    ],
  },
];

function isNavigationGroup(entry: NavigationEntry): entry is NavigationGroup {
  return "children" in entry;
}

const navigationItems = navigationEntries.map((entry) => {
  if (isNavigationGroup(entry)) {
    return {
      key: entry.key,
      icon: entry.icon,
      label: entry.label,
      children: entry.children.map((item) => ({
        key: item.key,
        ...(item.icon ? { icon: item.icon } : {}),
        label: item.label,
      })),
    };
  }

  return {
    key: entry.key,
    icon: entry.icon,
    label: entry.label,
  };
}) satisfies NonNullable<MenuProps["items"]>;

function getNavigationPath(key: string) {
  for (const entry of navigationEntries) {
    if (isNavigationGroup(entry)) {
      const child = entry.children.find((item) => item.key === key);

      if (child) {
        return child.path;
      }

      continue;
    }

    if (entry.key === key) {
      return entry.path;
    }
  }

  return null;
}

function getCurrentNavigation(pathname: string) {
  for (const entry of navigationEntries) {
    if (isNavigationGroup(entry)) {
      for (const child of entry.children) {
        if (pathname === child.path || pathname.startsWith(`${child.path}/`)) {
          return {
            openKey: entry.key,
            selectedKey: child.key,
          };
        }
      }

      continue;
    }

    if (pathname === entry.path || pathname.startsWith(`${entry.path}/`)) {
      return {
        openKey: null,
        selectedKey: entry.key,
      };
    }
  }

  return {
    openKey: null,
    selectedKey: "dashboard",
  };
}

function WorkspaceNavigation({
  collapsed = false,
  currentSelectedKey,
  defaultOpenKeys,
  onMenuSelect,
}: {
  collapsed?: boolean;
  currentSelectedKey: string;
  defaultOpenKeys: string[];
  onMenuSelect?: (key: string) => void;
}) {
  const { token } = theme.useToken();
  const [openKeys, setOpenKeys] = useState(defaultOpenKeys);

  return (
    <Flex
      vertical
      gap={20}
      style={{ minHeight: "100%", padding: collapsed ? "24px 12px 16px" : "24px 16px 16px" }}
    >
      <Flex align="center" gap={collapsed ? 0 : 12} justify={collapsed ? "center" : "flex-start"}>
        <Flex
          align="center"
          justify="center"
          style={{
            width: 44,
            height: 44,
            borderRadius: 14,
            background: "#465fff",
            color: "#ffffff",
            fontSize: 18,
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          AR
        </Flex>
        {!collapsed ? (
          <Space orientation="vertical" size={2}>
            <Text strong style={{ color: token.colorText }}>
              Account Resource Manager
            </Text>
          </Space>
        ) : null}
      </Flex>

      <Menu
        mode="inline"
        inlineCollapsed={collapsed}
        openKeys={collapsed ? [] : openKeys}
        onOpenChange={(keys) => setOpenKeys(keys as string[])}
        selectedKeys={[currentSelectedKey]}
        onClick={({ key }) => onMenuSelect?.(key)}
        items={navigationItems}
        style={{
          flex: "1 1 auto",
          marginTop: 12,
          background: "transparent",
          borderInlineEnd: "none",
        }}
      />
    </Flex>
  );
}

export function WorkspaceShell({
  children,
  accountEmail,
}: {
  children: ReactNode;
  accountEmail: string;
}) {
  const { message } = App.useApp();
  const pathname = usePathname();
  const router = useRouter();
  const { token } = theme.useToken();
  const currentNavigation = getCurrentNavigation(pathname);
  const [desktopCollapsed, setDesktopCollapsed] = useState(false);
  const [desktopHovered, setDesktopHovered] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [logoutLoading, setLogoutLoading] = useState(false);
  const defaultOpenKeys = currentNavigation.openKey ? [currentNavigation.openKey] : [];
  const desktopExpanded = !desktopCollapsed || desktopHovered;
  const effectiveDesktopCollapsed = !desktopExpanded;
  const headerIconButtonStyle = {
    width: 40,
    height: 40,
    borderRadius: 999,
    border: `1px solid ${token.colorBorderSecondary}`,
    background: token.colorBgContainer,
    boxShadow: "var(--shadow-soft)",
    color: token.colorTextSecondary,
  } as const;

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    const desktopMediaQuery = window.matchMedia("(min-width: 992px)");

    if (desktopMediaQuery.matches) {
      setMobileMenuOpen(false);
    }

    function handleDesktopChange(event: MediaQueryListEvent) {
      if (event.matches) {
        setMobileMenuOpen(false);
      }
    }

    desktopMediaQuery.addEventListener("change", handleDesktopChange);

    return () => {
      desktopMediaQuery.removeEventListener("change", handleDesktopChange);
    };
  }, []);

  function handleMenuSelect(key: string) {
    const nextPath = getNavigationPath(key);

    if (!nextPath) {
      return;
    }

    router.push(nextPath);
  }

  async function handleLogout() {
    try {
      setLogoutLoading(true);

      const response = await fetch("/api/auth/logout", {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error("logout_failed");
      }

      router.replace("/");
      router.refresh();
    } catch {
      message.error("退出登录失败，请重试");
    } finally {
      setLogoutLoading(false);
    }
  }

  const userMenuItems = [
    {
      key: "logout",
      icon: <LogoutOutlined />,
      danger: true,
      disabled: logoutLoading,
      label: logoutLoading ? "退出中..." : "退出登录",
    },
  ] satisfies MenuProps["items"];

  return (
    <Layout hasSider style={{ minHeight: "var(--arm-viewport-height)", background: "var(--background)" }}>
      <Sider
        className="arm-workspace-desktop-sider"
        collapsed={effectiveDesktopCollapsed}
        collapsedWidth={DESKTOP_SIDER_COLLAPSED_WIDTH}
        trigger={null}
        width={DESKTOP_SIDER_WIDTH}
        onMouseEnter={() => {
          if (desktopCollapsed) {
            setDesktopHovered(true);
          }
        }}
        onMouseLeave={() => setDesktopHovered(false)}
        style={{
          overflow: "hidden auto",
          position: "sticky",
          insetInlineStart: 0,
          top: 0,
          bottom: 0,
          height: "var(--arm-viewport-height)",
          background: "var(--shell-sidebar)",
          borderInlineEnd: `1px solid ${token.colorBorder}`,
          boxShadow: desktopHovered ? "var(--shadow-sidebar-hover)" : "none",
          transition:
            "all 0.3s cubic-bezier(0.2, 0, 0, 1), box-shadow 0.2s ease",
          zIndex: SHELL_SIDER_Z_INDEX,
        }}
      >
        <WorkspaceNavigation
          key={`desktop-${pathname}`}
          collapsed={effectiveDesktopCollapsed}
          currentSelectedKey={currentNavigation.selectedKey}
          defaultOpenKeys={defaultOpenKeys}
          onMenuSelect={handleMenuSelect}
        />
      </Sider>

      <Drawer
        rootClassName="arm-workspace-mobile-drawer"
        open={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
        placement="left"
        width="min(320px, 88vw)"
        closable
        destroyOnHidden
        zIndex={SHELL_DRAWER_Z_INDEX}
        styles={{
          body: {
            padding: 0,
            background: "var(--surface)",
          },
          header: {
            background: "var(--surface)",
            borderBottom: `1px solid ${token.colorBorder}`,
          },
        }}
      >
        <WorkspaceNavigation
          key={`mobile-${pathname}`}
          currentSelectedKey={currentNavigation.selectedKey}
          defaultOpenKeys={defaultOpenKeys}
          onMenuSelect={(key) => {
            handleMenuSelect(key);
            setMobileMenuOpen(false);
          }}
        />
      </Drawer>

      <Layout style={{ minWidth: 0, background: "transparent" }}>
        <Header
          className="arm-workspace-header"
          style={{
            position: "sticky",
            top: 0,
            zIndex: SHELL_HEADER_Z_INDEX,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            height: "var(--arm-header-height)",
            background: "var(--shell-header)",
            borderBottom: `1px solid ${token.colorBorder}`,
            backdropFilter: "blur(10px)",
          }}
        >
          <Flex align="center" gap={12} style={{ minWidth: 0, flexShrink: 0, position: "relative", zIndex: 2 }}>
            <Button
              className="arm-workspace-desktop-trigger"
              type="text"
              icon={desktopCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => setDesktopCollapsed((value) => !value)}
              style={headerIconButtonStyle}
            />

            <Button
              className="arm-workspace-mobile-trigger"
              type="text"
              aria-label="打开导航菜单"
              icon={<MenuOutlined />}
              onClick={() => setMobileMenuOpen(true)}
              style={headerIconButtonStyle}
            />
          </Flex>

          <Space className="arm-workspace-header-actions" size={8}>
            <ThemeToggleButton />

            <Tooltip title="通知">
              <Button
                className="arm-workspace-notification-button"
                aria-label="查看通知"
                icon={
                  <span
                    style={{
                      position: "relative",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <BellOutlined />
                    <span
                      style={{
                        position: "absolute",
                        top: -3,
                        right: -3,
                        width: 8,
                        height: 8,
                        borderRadius: 999,
                        background: token.colorPrimary,
                        boxShadow: `0 0 0 2px ${token.colorBgContainer}`,
                      }}
                    />
                  </span>
                }
                onClick={() => message.info("通知中心即将开放")}
                style={headerIconButtonStyle}
              />
            </Tooltip>

            <Dropdown
              trigger={["click"]}
              placement="bottomRight"
              popupRender={() => (
                <div
                  style={{
                    width: "min(280px, calc(100vw - 32px))",
                    borderRadius: 20,
                    overflow: "hidden",
                    background: token.colorBgElevated,
                    border: `1px solid ${token.colorBorderSecondary}`,
                    boxShadow: token.boxShadowSecondary,
                  }}
                >
                  <Flex
                    align="center"
                    gap={12}
                    style={{
                      padding: 16,
                      borderBottom: `1px solid ${token.colorBorderSecondary}`,
                    }}
                  >
                    <Badge dot color={token.colorSuccess} offset={[-2, 34]}>
                      <Avatar
                        size={44}
                        icon={<UserOutlined />}
                        style={{ background: token.colorPrimaryBg, color: token.colorPrimary }}
                      />
                    </Badge>
                    <Flex vertical gap={2} style={{ minWidth: 0 }}>
                      <Text strong style={{ color: token.colorText }}>
                        账户中心
                      </Text>
                      <Text
                        type="secondary"
                        style={{
                          fontSize: 12,
                          wordBreak: "break-all",
                        }}
                      >
                        {accountEmail}
                      </Text>
                    </Flex>
                  </Flex>

                  <Menu
                    selectable={false}
                    items={userMenuItems}
                    onClick={({ key }) => {
                      if (key === "logout") {
                        void handleLogout();
                      }
                    }}
                    style={{
                      padding: 8,
                      background: "transparent",
                      borderInlineEnd: "none",
                    }}
                  />
                </div>
              )}
            >
              <Tooltip title="账户菜单">
                <Button
                  className="arm-workspace-account-button"
                  aria-label="打开账户菜单"
                  style={{
                    ...headerIconButtonStyle,
                    width: "auto",
                    paddingInline: 8,
                  }}
                >
                  <Flex align="center" gap={8}>
                    <Avatar
                      size={28}
                      icon={<UserOutlined />}
                      style={{ background: token.colorPrimaryBg, color: token.colorPrimary }}
                    />
                    <DownOutlined
                      style={{
                        fontSize: 11,
                        color: token.colorTextTertiary,
                      }}
                    />
                  </Flex>
                </Button>
              </Tooltip>
            </Dropdown>
          </Space>
        </Header>

        <Content className="arm-workspace-content" style={{ background: "var(--background)" }}>
          <Flex vertical gap={20} style={{ minHeight: "calc(var(--arm-viewport-height) - var(--arm-header-height))", minWidth: 0 }}>
            {children}
          </Flex>
        </Content>
      </Layout>
    </Layout>
  );
}
