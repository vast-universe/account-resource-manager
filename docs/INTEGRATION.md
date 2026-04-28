# 集成说明

## 已完成的集成工作

### 1. Worker 服务 (services/worker)

完整复制了 any-auto-register 中的支付注册功能：

**核心文件：**
- `chatgpt/payment_registration_engine.py` - 支付注册引擎
- `chatgpt/chatgpt_client.py` - ChatGPT 客户端（使用 curl_cffi）
- `chatgpt/utils.py` - 工具函数
- `chatgpt/currency_mapping.py` - 货币映射
- `chatgpt/sentinel_token.py` - Sentinel token 生成
- `chatgpt/sentinel_browser.py` - 浏览器 Sentinel token
- `chatgpt/payment.py` - 支付核心逻辑
- `core/proxy_utils.py` - 代理工具
- `core/browser_runtime.py` - 浏览器运行时
- `core/task_runtime.py` - 任务运行时

**服务文件：**
- `main.py` - FastAPI 主服务
- `utils/email_service.py` - 邮箱服务适配器
- `requirements.txt` - Python 依赖
- `Dockerfile` - Docker 镜像配置
- `migrations/001_create_tables.sql` - 数据库迁移脚本

### 2. 前端集成 (apps/web)

**API 路由：**
- `/api/chatgpt/payment-registration` - 创建支付注册任务
- `/api/chatgpt/tasks/[taskId]` - 查询任务状态

**页面更新：**
- `resources/chatgpt/page.tsx` - 添加支付注册按钮和弹窗

### 3. 基础设施

**Docker Compose：**
- 添加 worker 服务配置
- 自动加载数据库迁移脚本

**文档：**
- 更新主 README
- 创建 Worker 服务 README
- 创建启动脚本

## 使用方法

### 快速启动

```bash
# 使用启动脚本（推荐）
./scripts/start.sh

# 或手动启动
docker-compose up -d
npm run dev:web
```

### 配置环境变量

在 `apps/web/.env.local` 中配置：

```env
# Worker 服务地址
WORKER_SERVICE_URL=http://localhost:8001

# 数据库连接
DATABASE_URL=postgresql://arm_user:arm_password@localhost:5432/arm_dev
```

### 使用支付注册功能

1. 访问 http://localhost:3000
2. 登录后进入 "ChatGPT 账号" 页面
3. 点击 "支付注册" 按钮
4. 配置选项：
   - 邮箱提供商（可选，留空自动选择）
   - 代理地址（可选）
   - 最大重试次数
5. 点击 "开始注册"
6. 系统会自动：
   - 创建邮箱
   - 完成注册流程
   - 获取验证码
   - 创建支付会话
   - 保存账号信息

### 监控任务状态

任务创建后会自动轮询状态，完成后会：
- 显示成功/失败消息
- 自动刷新账号列表
- 账号信息保存到数据库

## 数据库表结构

### registration_tasks
注册任务表，记录所有支付注册任务的状态

### chatgpt_accounts
ChatGPT 账号表，新增字段：
- `checkout_url` - Plus 支付链接
- `team_checkout_url` - Team 支付链接
- `email_service_id` - 邮箱服务ID

### email_messages
邮件消息表，用于存储和查询验证码

## 技术栈

- **Worker 服务**: Python 3.11 + FastAPI + curl_cffi
- **前端**: Next.js + TypeScript + Ant Design
- **数据库**: PostgreSQL 16
- **容器化**: Docker + Docker Compose

## 注意事项

1. **代理配置**: 如果需要使用代理，确保代理服务可用
2. **邮箱服务**: 需要先配置邮箱提供商（Email Providers）
3. **数据库迁移**: 首次启动会自动执行数据库迁移
4. **依赖安装**: Worker 服务需要 curl_cffi，可能需要编译环境

## 故障排查

### Worker 服务无法启动
```bash
# 查看日志
docker-compose logs worker

# 重启服务
docker-compose restart worker
```

### 数据库连接失败
```bash
# 检查 PostgreSQL 状态
docker-compose ps postgres

# 查看数据库日志
docker-compose logs postgres
```

### 前端无法连接 Worker
检查 `WORKER_SERVICE_URL` 环境变量是否正确配置

## 下一步

可以考虑的改进：
1. 添加任务队列（如 Celery）处理大量并发注册
2. 添加 WebSocket 实时推送任务状态
3. 添加任务重试和失败恢复机制
4. 添加更详细的日志和监控
5. 支持批量注册
