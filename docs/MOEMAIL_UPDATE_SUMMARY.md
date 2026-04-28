# MoeMail 集成更新总结

## 更新时间
2024-04-25

## 更新内容

已完成 Worker 服务与 MoeMail API 的完整集成，支持使用配置的 API Key 进行邮箱创建和验证码接收。

## 主要变更

### 1. 邮箱服务适配器 (`services/worker/utils/email_service.py`)

**更新前**:
- 使用模拟数据
- 从数据库 email_messages 表查询邮件

**更新后**:
- ✅ 调用 MoeMail API 创建邮箱 (`POST /api/emails/generate`)
- ✅ 调用 MoeMail API 查询邮件 (`GET /api/emails/{emailId}`)
- ✅ 自动提取多种格式的验证码
- ✅ 正确处理加密的 API Key
- ✅ 存储邮箱 ID 用于后续查询

### 2. 加密工具 (`services/worker/utils/crypto.py`)

**新增文件**:
- ✅ 实现 AES-256-GCM 解密算法
- ✅ 与前端加密格式完全兼容
- ✅ 支持 v1 加密格式
- ✅ 使用环境变量配置密钥

### 3. 依赖更新 (`services/worker/requirements.txt`)

新增依赖:
```
cryptography>=42.0.0  # 加密解密
requests>=2.31.0      # HTTP 请求
```

### 4. 测试工具 (`services/worker/test_config.py`)

**新增文件**:
- ✅ 测试数据库连接
- ✅ 测试邮箱提供商配置
- ✅ 测试加密解密功能
- ✅ 测试 MoeMail API 连接
- ✅ 提供详细的错误提示

### 5. 文档更新

新增文档:
- `docs/MOEMAIL_INTEGRATION.md` - MoeMail 集成详细说明
- `services/worker/test_config.py` - 配置测试脚本

更新文档:
- `services/worker/README.md` - 添加测试说明

## 技术细节

### MoeMail API 集成

**创建邮箱**:
```python
POST {api_url}/api/emails/generate
Headers:
  X-API-Key: {decrypted_api_key}
  Content-Type: application/json
Body:
  {
    "expiryTime": 0,
    "domain": "example.com"
  }
```

**查询邮件**:
```python
GET {api_url}/api/emails/{email_id}
Headers:
  X-API-Key: {decrypted_api_key}
```

### 验证码提取

支持的验证码格式:
- `verification code is: 123456`
- `code: 123456`
- `Your code is 123456`
- 邮件正文中的独立 6 位数字
- 邮件主题中的 6 位数字

正则表达式:
```python
patterns = [
    r'verification code is[:\s]+(\d{6})',
    r'code[:\s]+(\d{6})',
    r'\b(\d{6})\b',
]
```

### 加密解密

格式: `v1.{iv}.{auth_tag}.{ciphertext}` (base64url 编码)

算法: AES-256-GCM

密钥来源:
1. `ARM_DATA_ENCRYPTION_KEY` 环境变量
2. `ARM_SESSION_SECRET` 环境变量
3. 默认值（仅用于开发）

## 使用流程

### 1. 配置邮箱提供商

在 Web 界面:
1. 进入 "设置 > 邮箱提供商"
2. 添加 MoeMail 提供商
3. 填写 API URL 和 API Key
4. 设为默认

### 2. 配置环境变量

```bash
# 必须与 Web 应用一致
export ARM_DATA_ENCRYPTION_KEY="your-encryption-key"

# 或
export ARM_SESSION_SECRET="your-session-secret"
```

### 3. 测试配置

```bash
cd services/worker
python test_config.py
```

预期输出:
```
============================================================
MoeMail 集成配置测试
============================================================
1. 测试数据库连接...
   ✅ 数据库连接成功: PostgreSQL 16...
2. 测试邮箱提供商配置...
   ✅ 找到邮箱提供商:
      ID: 1
      名称: MoeMail
      类型: moemail
      API URL: https://moemail.example.com
      状态: active
3. 测试加密解密...
   ✅ 加密密钥已配置 (长度: 32)
   ✅ API key 解密成功 (长度: 64)
4. 测试 MoeMail API 连接...
   ✅ MoeMail API 连接成功
      可用域名: example.com,test.com
      最大邮箱数: 1000
============================================================
测试结果汇总
============================================================
数据库连接              ✅ 通过
邮箱提供商              ✅ 通过
加密解密                ✅ 通过
MoeMail API            ✅ 通过
============================================================

🎉 所有测试通过！可以开始使用支付注册功能。
```

### 4. 启动服务

```bash
# 使用 Docker Compose
docker-compose up -d

# 或手动启动
python main.py
```

### 5. 执行支付注册

在 Web 界面:
1. 进入 "ChatGPT 账号" 页面
2. 点击 "支付注册" 按钮
3. 配置选项并提交
4. 等待任务完成

## 验证

### 查看日志

```bash
# Worker 日志
docker-compose logs -f worker

# 查看特定任务
docker-compose logs worker | grep "task_id"
```

### 检查数据库

```sql
-- 查看邮箱提供商
SELECT id, name, provider_type, api_url, status
FROM email_providers
WHERE deleted_at IS NULL;

-- 查看注册任务
SELECT task_id, status, result, error_message, created_at
FROM registration_tasks
ORDER BY created_at DESC
LIMIT 10;

-- 查看创建的账号
SELECT email, status, registration_source, checkout_url, created_at
FROM chatgpt_accounts
ORDER BY created_at DESC
LIMIT 10;
```

## 故障排查

### 问题 1: 解密失败

**错误**: `解密 API key 失败`

**原因**: 加密密钥不一致

**解决**:
```bash
# 确认 Web 应用使用的密钥
echo $ARM_DATA_ENCRYPTION_KEY

# 在 Worker 服务中设置相同的密钥
export ARM_DATA_ENCRYPTION_KEY="same-key-as-web-app"
```

### 问题 2: MoeMail API 401

**错误**: `MoeMail API error: 401`

**原因**: API Key 错误或未配置

**解决**:
1. 检查 Web 界面中的 API Key 配置
2. 运行测试脚本验证: `python test_config.py`
3. 查看 MoeMail 服务日志

### 问题 3: 未收到验证码

**原因**: 
- 邮件延迟
- 验证码格式不匹配
- MoeMail 服务问题

**解决**:
1. 检查 MoeMail 界面是否收到邮件
2. 查看 Worker 日志中的邮件内容
3. 调整超时时间或验证码正则表达式

## 性能指标

- 邮箱创建: ~2-5 秒
- 验证码接收: ~10-30 秒（取决于邮件延迟）
- 完整注册流程: ~60-120 秒
- 并发支持: 多任务并行处理

## 安全性

- ✅ API Key 加密存储
- ✅ 使用 AES-256-GCM 加密
- ✅ 环境变量管理密钥
- ✅ HTTPS 通信（如果配置）
- ✅ 数据库连接加密（如果配置）

## 下一步

建议的改进:
1. 添加 WebSocket 实时状态推送
2. 实现任务队列（Celery/RQ）
3. 添加 Prometheus 监控
4. 支持更多邮箱服务提供商
5. 实现邮箱池管理

## 相关文档

- [集成说明](./INTEGRATION.md)
- [MoeMail 集成详细说明](./MOEMAIL_INTEGRATION.md)
- [Worker 服务 README](../services/worker/README.md)
- [支付注册总结](./PAYMENT_REGISTRATION_SUMMARY.md)
