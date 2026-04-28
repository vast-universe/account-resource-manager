# Token 提取功能集成文档

## 功能概述

将 `extract_all_tokens.py` 的核心功能集成到 account-resource-manager 中，支持通过 Web 界面提取 ChatGPT 账号的 workspace tokens。

## 实现内容

### 1. 数据库迁移

**文件**: `services/worker/migrations/011_add_workspace_tokens_field.sql`

添加 `workspace_tokens` 字段到 `chatgpt_accounts` 表，用于存储多个 workspace 的 token 信息。

```sql
ALTER TABLE chatgpt_accounts
ADD COLUMN IF NOT EXISTS workspace_tokens JSONB DEFAULT '[]'::jsonb;
```

**运行迁移**:
```bash
cd services/worker
psql -d your_database -f migrations/011_add_workspace_tokens_field.sql
```

### 2. 后端实现

#### Token 提取引擎

**文件**: `services/worker/chatgpt/token_extractor.py`

核心类 `TokenExtractor` 实现了：
- OAuth 登录流程
- MoeMail 邮箱验证码获取
- Authorization code 交换
- 多个 workspace tokens 提取

#### API 端点

**文件**: `services/worker/main.py`

新增 API 端点：
```
POST /api/chatgpt/extract-tokens
```

**请求参数**:
```json
{
  "account_id": 123,
  "moemail_email_id": "your_moemail_id"
}
```

**响应**:
```json
{
  "success": true,
  "message": "成功提取 3 个 workspace 的 tokens",
  "workspaces": [
    {
      "workspace_id": "org-xxx",
      "workspace_name": "Personal",
      "access_token": "...",
      "refresh_token": "...",
      "expires_at": 1234567890,
      "expires_in": 2592000
    }
  ]
}
```

### 3. 前端实现

#### API 路由

**文件**: `apps/web/src/app/api/chatgpt/extract-tokens/route.ts`

Next.js API 路由，转发请求到 worker 服务。

#### UI 组件

**文件**: `apps/web/src/app/(workspace)/resources/chatgpt/page.tsx`

在账号列表页面添加：
- "提取 Token" 按钮（每个账号一个）
- 提取 Token 弹窗（输入 MoeMail 邮箱 ID）
- 提取进度提示

## 使用流程

### 1. 准备工作

确保环境变量配置正确：

```bash
# .env 或环境变量
MOEMAIL_API=https://moemail-4gj.pages.dev
MOEMAIL_API_KEY=your_api_key
```

### 2. 提取 Token

1. 登录 account-resource-manager Web 界面
2. 进入 "ChatGPT 账号" 页面
3. 找到需要提取 token 的账号
4. 点击该账号行的 "提取 Token" 按钮
5. 在弹窗中输入 MoeMail 邮箱 ID
6. 点击 "开始提取"
7. 系统会自动：
   - 使用账号的邮箱和密码进行 OAuth 登录
   - 从 MoeMail 获取验证码
   - 完成二次认证
   - 提取所有 workspace 的 tokens
   - 保存到数据库

### 3. 查看结果

提取成功后：
- 数据库中的 `access_token` 和 `refresh_token` 字段会更新为第一个 workspace 的 token
- `workspace_tokens` 字段包含所有 workspace 的完整信息（JSON 格式）

## 数据结构

### workspace_tokens 字段格式

```json
[
  {
    "workspace_id": "org-xxx",
    "workspace_name": "Personal",
    "access_token": "eyJhbGc...",
    "refresh_token": "eyJhbGc...",
    "expires_at": 1234567890000,
    "expires_in": 2592000
  },
  {
    "workspace_id": "org-yyy",
    "workspace_name": "Team Workspace",
    "access_token": "eyJhbGc...",
    "refresh_token": "eyJhbGc...",
    "expires_at": 1234567890000,
    "expires_in": 2592000
  }
]
```

## 导出为 sub2api 格式

提取的 tokens 可以直接用于生成 sub2api 导入格式：

```python
# 从数据库读取
account = get_account_from_db(account_id)
workspace_tokens = json.loads(account['workspace_tokens'])

# 生成 sub2api 格式
sub2api_accounts = []
for workspace in workspace_tokens:
    sub2api_accounts.append({
        "proxy_id": None,
        "credentials": {
            "refresh_token": workspace['refresh_token'],
            "chatgpt_account_id": workspace['workspace_id'],
            "access_token": workspace['access_token'],
            "_token_version": int(time.time() * 1000),
            "expires_at": workspace['expires_at'],
            "expires_in": workspace['expires_in'],
            "email": account['email'],
            "chatgpt_user_id": ""
        },
        "concurrency": 10,
        "priority": 1,
        "rate_multiplier": 1,
        "auto_pause_on_expired": True
    })

sub2api_export = {
    "exported_at": int(time.time() * 1000),
    "proxies": [],
    "accounts": sub2api_accounts
}
```

## 注意事项

1. **MoeMail 邮箱 ID**: 必须是有效的 MoeMail 邮箱 ID，用于接收 OAuth 验证码
2. **账号密码**: 数据库中必须保存明文密码（`chatgpt_accounts.password`）
3. **代理配置**: 如果需要使用代理，确保代理池中有可用代理
4. **验证码超时**: 默认等待 120 秒，如果超时需要重新提取
5. **并发限制**: 建议不要同时提取太多账号，避免触发 OpenAI 限流

## 故障排查

### 提取失败：未收到验证码

- 检查 MoeMail 邮箱 ID 是否正确
- 检查 MoeMail API 配置是否正确
- 检查网络连接

### 提取失败：密码验证失败

- 检查数据库中的密码是否正确
- 尝试手动登录验证密码

### 提取失败：Token 交换失败

- 检查代理配置
- 检查 OAuth 配置（issuer, client_id, redirect_uri）
- 查看后端日志获取详细错误信息

## 后续优化

1. 添加批量提取功能
2. 添加定时自动刷新 token 功能
3. 添加 token 过期提醒
4. 支持直接导出为 sub2api 格式文件
