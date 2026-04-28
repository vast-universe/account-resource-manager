import type { Metadata } from "next";
import { AntdRegistry } from "@ant-design/nextjs-registry";
import { cookies } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import { AppProviders } from "@/components/app-providers";
import "antd/dist/reset.css";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "资源管理台 | Account Resource Manager",
  description: "使用 Next.js 与 Ant Design 构建的企业资源管理工作台。",
};

const themeInitScript = `
  (function () {
    var storageKey = "arm-theme-mode";
    var root = document.documentElement;
    var cookieMatch = document.cookie.match(new RegExp("(^|; )" + storageKey + "=([^;]+)"));
    var cookieMode = cookieMatch ? decodeURIComponent(cookieMatch[2]) : null;
    var storedMode = localStorage.getItem(storageKey);
    var mode = storedMode === "dark" || storedMode === "light"
      ? storedMode
      : cookieMode === "dark"
        ? "dark"
        : "light";
    root.classList.toggle("dark", mode === "dark");
    root.dataset.theme = mode;
  })();
`;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const defaultMode = cookieStore.get("arm-theme-mode")?.value === "dark" ? "dark" : "light";

  return (
    <html
      lang="zh-CN"
      className={`${geistSans.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <body suppressHydrationWarning>
        <Script id="theme-init" strategy="beforeInteractive">
          {themeInitScript}
        </Script>
        <AntdRegistry>
          <AppProviders defaultMode={defaultMode}>{children}</AppProviders>
        </AntdRegistry>
      </body>
    </html>
  );
}
