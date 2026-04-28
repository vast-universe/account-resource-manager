"use client";

import { MoonOutlined, SunOutlined } from "@ant-design/icons";
import { Button, Tooltip, theme } from "antd";
import { useThemeMode } from "@/components/app-providers";

type ThemeToggleButtonProps = {
  size?: number;
  withTooltip?: boolean;
};

export function ThemeToggleButton({
  size = 40,
  withTooltip = true,
}: ThemeToggleButtonProps) {
  const { token } = theme.useToken();
  const { isDarkMode, toggleMode } = useThemeMode();
  const title = isDarkMode ? "切换为浅色模式" : "切换为暗黑模式";

  const button = (
    <Button
      aria-label={title}
      icon={isDarkMode ? <SunOutlined /> : <MoonOutlined />}
      onClick={toggleMode}
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        border: `1px solid ${token.colorBorderSecondary}`,
        background: isDarkMode ? "rgba(255, 255, 255, 0.04)" : token.colorBgContainer,
        boxShadow: "var(--shadow-soft)",
        color: token.colorTextSecondary,
      }}
    />
  );

  if (!withTooltip) {
    return button;
  }

  return <Tooltip title={title}>{button}</Tooltip>;
}
