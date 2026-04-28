# Token 提取功能完整实现总结

## ✅ 已完成的功能

### 1. 数据库支持
- ✅ 添加 `workspace_tokens` JSONB 字段存储多个 workspace 的 token 信息
- ✅ 迁移文件：`011_add_workspace_tokens_field.sql`

### 2. 后端 API

#### Token 提取引擎 (`token_extractor.py`)
- ✅ OAuth 登录流程（完整实现）
- ✅ MoeMail 邮箱验证码自动获取
- ✅ 调用 `/backend-api/accounts/check/v4-2023-04-27` 获取所有 workspace
- ✅ 为每个 workspace 保存全局 Codex Token
- ✅ 支持代理配置

#### API 端点
- ✅ `POST /api/chatgpt/extract-tokens` - 提取单个账号的 tokens
- ✅ `POST /api/chatgpt/export-sub2api` - 导出所有账号为 sub2api 格式

### 3. 前端功能

#### 提取 Token
- ✅ 每个账号行的"提取 Token"按钮
- ✅ 提取 Token 弹窗（输入 MoeMail 邮箱 ID）
- ✅ 提取进度提示
- ✅ 提取结果保存到数据库

#### 导出 sub2api
- ✅ "导出 sub2api"按钮（顶部工具栏）
- ✅ 自动生成 `sub2api_batch_import.json` 文件
- ✅ 下载到本地

### 4. UI 优化
- ✅ 固定邮箱列（左侧）
- ✅ 固定操作列（右侧）
- ✅ 删除状态图标列
- ✅ 支持横向滚动

## 功能对齐情况

### ✅ 与 extract_all_tokens.py 完全对齐

1. **OAuth 登录流程** ✅
   - PKCE 生成
   - 邮箱密码提交
   - OTP 验证（MoeMail）
   - Authorization code 交换
   - Access token 获取

2. **Workspace 提取** ✅
   - 使用正确的 API：`/backend-api/accounts/check/v4-2023-04-27`
   - 获取所有 workspace 列表
   - 为每个 workspace 保存全局 Codex Token
   - 过滤 "default" 和 "global" workspace

3. **sub2api 导出格式** ✅
   - 完全符合 sub2api AdminDataPayload 格式
   - 包含所有必需字段：
     - `exported_at`
     - `proxies`
     - `accounts` (包含 credentials, extra, concurrency 等)
   - credentials 包含：
     - `refresh_token`
     - `chatgpt_account_id` (workspace_id)
     - `access_token`
     - `_token_version`
     - `expires_at`
     - `expires_in`
     - `email`
     - `chatgpt_user_id`

## 使用流程

### 1. 提取 Token

```
1. 在账号列表找到需要提取的账号
2. 点击该账号的"提取 Token"按钮
3. 在弹窗中输入 MoeMail 邮箱 ID
4. 点击"开始提取"
5. 系统自动完成 OAuth 认证并提取所有 workspace tokens
6. 提取结果保存到数据库的 workspace_tokens 字段
```

### 2. 导出 sub2api 格式

```
1. 点击顶部的"导出 sub2api"按钮
2. 系统自动读取所有账号的 workspace_tokens
3. 生成 sub2api_batch_import.json 文件
4. 自动下载到本地
5. 在 sub2api 管理界面导入该文件
```

## 数据流程

```
提取 Token:
用户点击 → 前端弹窗 → 输入 MoeMail ID → 调用后端 API
→ TokenExtractor 执行 OAuth 登录 → 获取 access_token
→ 调用 ChatGPT API 获取 workspaces → 保存到数据库

导出 sub2api:
用户点击 → 调用后端 API → 读取所有 workspace_tokens
→ 生成 sub2api 格式 JSON → 返回前端 → 下载文件
```

## 数据库结构

### workspace_tokens 字段格式

```json
[
  {
    "workspace_id": "org-xxx",
    "workspace_name": "Personal",
    "plan_type": "plus",
    "access_token": "eyJhbGc...",
    "refresh_token": "",
    "expires_at": 1234567890000,
    "expires_in": 2592000
  },
  {
    "workspace_id": "org-yyy",
    "workspace_name": "Team Workspace",
    "plan_type": "team",
    "access_token": "eyJhbGc...",
    "refresh_token": "",
    "expires_at": 1234567890000,
    "expires_in": 2592000
  }
]
```

### sub2api_batch_import.json 格式

```json
{
  "exported_at": "2026-04-25T12:00:00Z",
  "proxies": [],
  "accounts": [
    {
      "name": "4-23-短效 #1",
      "platform": "openai",
      "type": "oauth",
      "credentials": {
        "refresh_token": "",
        "chatgpt_account_id": "org-xxx",
        "access_token": "eyJhbGc...",
        "_token_version": 1714046400000,
        "expires_at": 1234567890000,
        "expires_in": 2592000,
        "email": "user@example.com",
        "chatgpt_user_id": ""
      },
      "extra": {
        "email": "user@example.com",
        "card_type": "短效"
      },
      "concurrency": 10,
      "priority": 1,
      "rate_multiplier": 1,
      "auto_pause_on_expired": true
    }
  ]
}
```

> 账号名称按“月-日-绑卡类型 #序号”格式生成，例如 `4-23-短效 #1`、`4-23-长效 #2`。

## 部署步骤

### 1. 运行数据库迁移

```bash
cd services/worker
psql -d your_database -f migrations/011_add_workspace_tokens_field.sql
```

### 2. 配置环境变量

```bash
# .env
MOEMAIL_API=https://moemail-4gj.pages.dev
MOEMAIL_API_KEY=your_api_key
```

### 3. 重启服务

```bash
# 重启 worker 服务
cd services/worker
python main.py

# 重启前端
cd apps/web
npm run dev
```

## 注意事项

1. **MoeMail 邮箱 ID**：必须是有效的 MoeMail 邮箱 ID，用于接收 OAuth 验证码
2. **账号密码**：数据库中必须保存明文密码（`chatgpt_accounts.password` 字段）
3. **全局 Token**：OAuth 返回的是全局 Codex Token，可以访问所有 workspace
4. **过期时间**：Token 默认有效期 30 天
5. **导出过滤**：自动过滤 "default" 和 "global" workspace

## 功能完整性确认

✅ **完全实现**：所有功能都已实现并与 extract_all_tokens.py 对齐
✅ **导出格式**：完全符合 sub2api_batch_import.json 格式
✅ **UI 优化**：固定列、删除状态列、横向滚动
✅ **错误处理**：完整的错误提示和日志记录
✅ **用户体验**：简单易用的 Web 界面操作

## 测试建议

1. 提取一个账号的 tokens，检查 workspace_tokens 字段
2. 导出 sub2api 文件，检查格式是否正确
3. 在 sub2api 中导入文件，验证是否可用
4. 测试多个 workspace 的账号
5. 测试错误情况（无效邮箱 ID、密码错误等）
