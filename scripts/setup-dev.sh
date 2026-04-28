#!/bin/bash

# Account Resource Manager - 本地开发环境设置脚本

set -e

echo "🚀 Account Resource Manager - 本地开发环境设置"
echo ""

# 检查 PostgreSQL 是否安装
if ! command -v psql &> /dev/null; then
    echo "❌ PostgreSQL 未安装"
    echo "请先安装 PostgreSQL:"
    echo "  macOS: brew install postgresql@16"
    echo "  Ubuntu: sudo apt install postgresql"
    exit 1
fi

echo "✅ PostgreSQL 已安装"

# 检查 PostgreSQL 是否运行
if ! pg_isready &> /dev/null; then
    echo "⚠️  PostgreSQL 未运行，尝试启动..."
    if command -v brew &> /dev/null; then
        brew services start postgresql@16
    else
        sudo systemctl start postgresql
    fi
    sleep 2
fi

# 创建数据库
DB_NAME="arm_dev"
echo ""
echo "📦 创建数据库: $DB_NAME"

if psql -lqt | cut -d \| -f 1 | grep -qw $DB_NAME; then
    echo "⚠️  数据库 $DB_NAME 已存在"
    read -p "是否删除并重新创建? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        dropdb $DB_NAME
        createdb $DB_NAME
        echo "✅ 数据库已重新创建"
    fi
else
    createdb $DB_NAME
    echo "✅ 数据库创建成功"
fi

# 运行迁移
echo ""
echo "🔄 运行数据库迁移..."

psql $DB_NAME < docs/sql/mailbox_v1.sql
echo "✅ mailbox_v1.sql 迁移完成"

psql $DB_NAME < docs/sql/email_providers_v1.sql
echo "✅ email_providers_v1.sql 迁移完成"

psql $DB_NAME < docs/sql/chatgpt_accounts_v1.sql
echo "✅ chatgpt_accounts_v1.sql 迁移完成"

# 更新 .env.local
echo ""
echo "📝 更新环境变量..."

ENV_FILE="apps/web/.env.local"
cat > $ENV_FILE << EOF
# Database Configuration
DATABASE_URL=postgresql://localhost:5432/$DB_NAME

# Data Encryption Key
ARM_DATA_ENCRYPTION_KEY=$(openssl rand -base64 32)

# Optional: Enable SSL for database connection
# ARM_DATABASE_SSL=require
EOF

echo "✅ 环境变量已更新: $ENV_FILE"

# 显示数据库信息
echo ""
echo "📊 数据库信息:"
psql $DB_NAME -c "\dt" | grep -E "mailboxes|email_providers|chatgpt_accounts"

echo ""
echo "✅ 本地开发环境设置完成！"
echo ""
echo "下一步:"
echo "  1. 启动开发服务器: npm run dev:web"
echo "  2. 访问: http://localhost:3000"
echo "  3. 配置 MoeMail API Key: /settings/email-providers"
echo ""
