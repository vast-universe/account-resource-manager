import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // 允许通过局域网 IP 访问开发服务器
  allowedDevOrigins: [
    "192.168.1.36",
    "192.168.0.0/16", // 允许整个 192.168.x.x 网段
  ],
};

export default nextConfig;
