#!/bin/bash

# 启动脚本 - Account Resource Manager

set -e

echo "🚀 启动 Account Resource Manager"
echo ""

# 检查 Docker
if ! command -v docker &> /dev/null; then
    echo "❌ Docker 未安装，请先安装 Docker"
    exit 1
fi

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js 未安装，请先安装 Node.js"
    exit 1
fi

# 启动 PostgreSQL 和 Worker 服务
echo "📦 启动 PostgreSQL 和 Worker 服务..."
docker-compose up -d --build

# 等待服务就绪
echo "⏳ 等待服务启动..."
sleep 5

# 检查服务状态
echo "✅ 检查服务状态..."
docker-compose ps

# 安装依赖（如果需要）
if [ ! -d "node_modules" ]; then
    echo "📦 安装 Node.js 依赖..."
    npm install
fi

# 启动 Web 应用
echo ""
echo "🌐 启动 Web 应用..."
echo "访问: http://localhost:3000"
echo ""
npm run dev:web
