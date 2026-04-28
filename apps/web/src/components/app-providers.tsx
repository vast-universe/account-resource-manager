"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { PropsWithChildren } from "react";
import type { ThemeConfig } from "antd";
import { App, ConfigProvider, theme } from "antd";
import zhCN from "antd/locale/zh_CN";

type ThemeMode = "light" | "dark";

type ThemeModeContextValue = {
  isDarkMode: boolean;
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  toggleMode: () => void;
};

const THEME_STORAGE_KEY = "arm-theme-mode";

const ThemeModeContext = createContext<ThemeModeContextValue | null>(null);

function applyThemeMode(mode: ThemeMode) {
  if (typeof document === "undefined") {
    return;
  }

  const root = document.documentElement;

  root.classList.toggle("dark", mode === "dark");
  root.dataset.theme = mode;
}

function createThemeConfig(mode: ThemeMode): ThemeConfig {
  const isDarkMode = mode === "dark";

  return {
    algorithm: isDarkMode ? theme.darkAlgorithm : theme.defaultAlgorithm,
    token: {
      colorPrimary: "#465fff",
      colorInfo: "#465fff",
      colorSuccess: "#12b76a",
      colorWarning: "#f79009",
      colorError: "#f04438",
      colorBgLayout: isDarkMode ? "#0c111d" : "#f9fafb",
      colorBgContainer: isDarkMode ? "#101828" : "#ffffff",
      colorBgElevated: isDarkMode ? "#182230" : "#ffffff",
      colorBorder: isDarkMode ? "#243041" : "#e4e7ec",
      colorBorderSecondary: isDarkMode ? "#344054" : "#f2f4f7",
      colorText: isDarkMode ? "rgba(255, 255, 255, 0.92)" : "#101828",
      colorTextSecondary: isDarkMode ? "#98a2b3" : "#667085",
      colorTextTertiary: isDarkMode ? "#667085" : "#98a2b3",
      colorFillSecondary: isDarkMode ? "rgba(255, 255, 255, 0.06)" : "#f2f4f7",
      colorFillTertiary: isDarkMode ? "rgba(255, 255, 255, 0.1)" : "#eaecf0",
      borderRadius: 16,
      controlHeight: 40,
      fontFamily: 'var(--font-geist-sans), "Segoe UI", sans-serif',
    },
    components: {
      Button: {
        fontWeight: 600,
        primaryShadow: "none",
      },
      Card: {
        borderRadiusLG: 16,
      },
      Layout: {
        bodyBg: isDarkMode ? "#0c111d" : "#f9fafb",
        headerBg: isDarkMode ? "#101828" : "#ffffff",
        headerHeight: 72,
        headerPadding: "0 24px",
        siderBg: isDarkMode ? "#101828" : "#ffffff",
        footerBg: isDarkMode ? "#0c111d" : "#f9fafb",
      },
      Menu: {
        itemBg: "transparent",
        itemColor: isDarkMode ? "#98a2b3" : "#344054",
        itemHoverColor: isDarkMode ? "#f9fafb" : "#344054",
        itemHoverBg: isDarkMode ? "rgba(255, 255, 255, 0.04)" : "#f2f4f7",
        itemSelectedColor: isDarkMode ? "#dce7ff" : "#465fff",
        itemSelectedBg: isDarkMode ? "rgba(70, 95, 255, 0.18)" : "#ecf3ff",
        popupBg: isDarkMode ? "#101828" : "#ffffff",
        subMenuItemBg: "transparent",
        groupTitleColor: isDarkMode ? "#667085" : "#98a2b3",
        itemBorderRadius: 12,
        itemHeight: 44,
      },
      Table: {
        headerBg: isDarkMode ? "#101828" : "#f9fafb",
        headerColor: isDarkMode ? "#f2f4f7" : "#344054",
        rowHoverBg: isDarkMode ? "rgba(255, 255, 255, 0.03)" : "#f9fafb",
      },
    },
  };
}

export function useThemeMode() {
  const context = useContext(ThemeModeContext);

  if (!context) {
    throw new Error("useThemeMode must be used within AppProviders");
  }

  return context;
}

export function AppProviders({
  children,
  defaultMode = "light",
}: PropsWithChildren<{ defaultMode?: ThemeMode }>) {
  const [mode, setMode] = useState<ThemeMode>(defaultMode);

  useEffect(() => {
    applyThemeMode(mode);
    window.localStorage.setItem(THEME_STORAGE_KEY, mode);
    document.cookie = `${THEME_STORAGE_KEY}=${mode}; path=/; max-age=31536000; samesite=lax`;
  }, [mode]);

  const themeConfig = useMemo(() => createThemeConfig(mode), [mode]);
  const contextValue = useMemo(
    () => ({
      isDarkMode: mode === "dark",
      mode,
      setMode,
      toggleMode: () => {
        setMode((currentMode) => (currentMode === "dark" ? "light" : "dark"));
      },
    }),
    [mode],
  );

  return (
    <ThemeModeContext.Provider value={contextValue}>
      <ConfigProvider locale={zhCN} theme={themeConfig}>
        <App>{children}</App>
      </ConfigProvider>
    </ThemeModeContext.Provider>
  );
}
