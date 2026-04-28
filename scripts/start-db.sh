#!/bin/bash

# Account Resource Manager - Docker 数据库启动脚本

set -e

echo "🐳 启动 PostgreSQL Docker 容器..."
echo ""

# 检查 Docker 是否运行
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker 未运行，请先启动 Docker Desktop"
    exit 1
fi

echo "✅ Docker 已运行"

# 启动容器
docker-compose up -d --build

echo ""
echo "⏳ 等待 PostgreSQL 启动..."
sleep 5

# 检查容器状态
if docker ps | grep -q arm-postgres; then
    echo "✅ PostgreSQL 容器已启动"
else
    echo "❌ PostgreSQL 容器启动失败"
    docker-compose logs
    exit 1
fi

# 等待数据库就绪
echo ""
echo "⏳ 等待数据库就绪..."
for i in {1..30}; do
    if docker exec arm-postgres pg_isready -U arm_user -d arm_dev > /dev/null 2>&1; then
        echo "✅ 数据库已就绪"
        break
    fi
    if [ $i -eq 30 ]; then
        echo "❌ 数据库启动超时"
        exit 1
    fi
    sleep 1
done

# 运行迁移
echo ""
echo "🔄 数据库迁移已通过 Docker 初始化脚本自动完成"

# 显示数据库信息
echo ""
echo "📊 数据库表:"
docker exec arm-postgres psql -U arm_user -d arm_dev -c "\dt" | grep -E "mailboxes|email_providers|chatgpt_accounts"

echo ""
echo "✅ 数据库设置完成！"
echo ""
echo "数据库信息:"
echo "  Host: localhost"
echo "  Port: 5432"
echo "  Database: arm_dev"
echo "  User: arm_user"
echo "  Password: arm_password"
echo ""
echo "管理命令:"
echo "  查看日志: docker-compose logs -f"
echo "  停止: docker-compose down"
echo "  重启: docker-compose restart"
echo "  连接数据库: docker exec -it arm-postgres psql -U arm_user -d arm_dev"
echo ""
echo "下一步:"
echo "  1. 启动开发服务器: npm run dev:web"
echo "  2. 访问: http://localhost:3000"
echo ""
