# Mailbox V1 Design

## Scope

V1 只覆盖邮箱资源的核心业务闭环，不做启用/停用、多角色权限、复杂仪表盘和自动化编排。

核心功能：

- 批量导入邮箱
- 邮箱列表查询
- 邮箱详情查看
- 手动检测邮箱
- 收件同步与查看
- 验证码提取

## Import Format

当前导入格式与前端页面保持一致，每行一条：

```text
邮箱----密码----配置ID----凭据
```

字段映射：

- `邮箱` -> `mailboxes.email`
- `密码` -> `mailbox_credentials.password_ciphertext`
- `配置ID` -> `mailboxes.profile_id`
- `凭据` -> `mailbox_credentials.auth_token_ciphertext`

解析规则：

- 使用 `----` 作为分隔符。
- 第 4 段及后续所有内容重新拼接为 `auth_token`，因为凭据文本本身可能包含 `----`。
- 只要邮箱格式合法，就视为结构有效。
- 导入按 `email_normalized` 去重，重复导入时执行覆盖更新。

导入后的默认值：

- `auth_mode = session`
- `health_status = unknown`
- `auth_status = unknown`
- `message_count = 0`
- `unread_count = 0`

## Data Model

### mailboxes

邮箱主表，只存列表页和检索高频字段。

关键字段：

- `public_id`: 对外暴露的 UUID
- `email`, `email_normalized`, `email_domain`
- `profile_id`
- `auth_mode`
- `health_status`
- `auth_status`
- `last_checked_at`, `last_check_result`
- `last_auth_refresh_at`, `auth_expires_at`
- `message_count`, `unread_count`, `latest_message_at`
- `created_at`, `updated_at`, `deleted_at`

说明：

- 列表页只查该表，不 join 邮件明细。
- `deleted_at` 用于软删除。
- `health_status` 表示邮箱可用性，`auth_status` 表示凭据可用性。

推荐枚举：

- `health_status`: `unknown | healthy | warning | invalid`
- `auth_status`: `unknown | valid | expiring | needs_refresh | reauth_required`
- `auth_mode`: `session | oauth`

### mailbox_credentials

敏感数据单独存储，不混在主表中。

关键字段：

- `mailbox_id`
- `password_ciphertext`
- `auth_token_ciphertext`
- `secret_version`
- `updated_at`

说明：

- 密码和凭据不得明文落库。
- V1 可以先用应用层加密，后续再升级到 KMS。

### mailbox_messages

存单邮箱收到的邮件记录。

关键字段：

- `mailbox_id`
- `message_uid`
- `from_address`
- `subject`
- `snippet`
- `category`
- `verification_code`
- `is_read`
- `received_at`
- `raw_payload`

说明：

- `verification_code` 为提取后的冗余字段，便于快速展示和复制。
- `raw_payload` 用于保留上游原始邮件结构，便于后续追查问题。
- 邮件表是增长最快的表，后续如果体量明显增大，可按 `received_at` 做月分区。

### mailbox_check_runs

记录手动检测或同步时产生的任务结果。

关键字段：

- `mailbox_id`
- `trigger_source`
- `status`
- `health_status_after`
- `auth_status_after`
- `checked_at`
- `error_message`
- `created_at`

说明：

- V1 可以先同步写入，后续再切换到 worker 异步执行。

## Query Strategy

### List Page

列表查询只读取 `mailboxes`，支持：

- 按邮箱搜索
- 按域名筛选
- 按 `health_status` 筛选
- 按 `auth_status` 筛选
- 按最近收件时间排序
- 按最近检测时间排序

十万级邮箱下的建议：

- 默认分页大小 `50`
- 优先使用 cursor/keyset 分页
- 避免深分页 `offset`
- 搜索字段使用规范化邮箱列 `email_normalized`

### Detail Page

详情页读取：

- `mailboxes`
- `mailbox_credentials`
- 最近一次或最近几次 `mailbox_check_runs`

### Messages Drawer

收件抽屉只查单邮箱最近 `20` 到 `50` 封邮件，不做跨邮箱邮件大查询。

## API Contract

### POST /mailboxes/import

用于批量导入文本内容或文件解析后的记录。

请求体建议：

```json
{
  "lines": [
    "demo1@outlook.com----password1----config-id-1----token-1",
    "demo2@hotmail.com----password2----config-id-2----token-2"
  ],
  "overwriteExisting": true
}
```

响应体建议：

```json
{
  "totalCount": 2,
  "validCount": 2,
  "invalidCount": 0,
  "createdCount": 1,
  "updatedCount": 1
}
```

### GET /mailboxes

查询参数建议：

- `q`
- `domain`
- `healthStatus`
- `authStatus`
- `cursor`
- `limit`
- `sortBy`
- `sortOrder`

响应体建议：

```json
{
  "items": [
    {
      "id": "a5d8970e-cac4-4a68-bc6e-e67b0f02a02a",
      "email": "demo1@outlook.com",
      "emailDomain": "outlook.com",
      "profileId": "config-id-1",
      "authMode": "session",
      "healthStatus": "healthy",
      "authStatus": "valid",
      "lastCheckedAt": "2026-04-15T08:00:00Z",
      "latestMessageAt": "2026-04-15T08:10:00Z",
      "messageCount": 24,
      "unreadCount": 1
    }
  ],
  "nextCursor": "opaque-cursor"
}
```

### GET /mailboxes/:publicId

返回单邮箱详情。

建议包含：

- 主信息
- 凭据更新时间
- 最近检测结果
- 最近统计字段

默认不直接返回完整敏感凭据。若业务必须展示，建议单独接口按权限拉取。

### PATCH /mailboxes/:publicId

允许更新：

- `profileId`
- `authMode`
- `password`
- `authToken`
- `authStatus`
- `lastAuthRefreshAt`
- `authExpiresAt`

### POST /mailboxes/:publicId/check

触发一次手动检测。

V1 行为建议：

- 记录一条 `mailbox_check_runs`
- 更新 `mailboxes.last_checked_at`
- 根据检测结果更新 `health_status` 和 `auth_status`

### GET /mailboxes/:publicId/messages

查询单邮箱收件列表。

查询参数建议：

- `cursor`
- `limit`
- `onlyUnread`

响应体建议：

```json
{
  "items": [
    {
      "id": "message-1",
      "fromAddress": "noreply@openai.com",
      "subject": "OpenAI verification code",
      "snippet": "Your verification code is 238941.",
      "category": "verification",
      "verificationCode": "238941",
      "isRead": false,
      "receivedAt": "2026-04-15T08:10:00Z"
    }
  ],
  "nextCursor": null
}
```

## Operational Rules

- 删除使用软删除，不执行物理删除。
- 同一邮箱地址全局唯一，统一使用 `email_normalized`。
- 所有统计字段由导入、同步收件和检测流程维护，不在列表查询时实时聚合。
- 检测和拉信后，更新 `message_count`、`unread_count`、`latest_message_at`。

## Scaling Notes

十万邮箱本身不重，真正的增长点在邮件明细和检测记录。

V1 阶段的扩展原则：

- 主表轻量化
- 邮件明细独立存储
- 高频统计做冗余
- 列表只查主表
- 单邮箱邮件按时间倒序分页

## Suggested Implementation Order

1. 先落数据库 schema 和 repository 层。
2. 再实现 `/mailboxes/import`、`/mailboxes`、`/mailboxes/:id`。
3. 然后将前端邮箱资源页从本地 `useState` 改为真实 CRUD。
4. 最后补手动检测、拉信和验证码提取的异步流程。
