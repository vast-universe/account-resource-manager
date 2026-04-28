# MoeMail 集成配置说明

## 更新内容

已更新 Worker 服务以正确使用 MoeMail API 进行邮箱创建和验证码接收。

## 关键更新

### 1. 邮箱服务适配器 (`utils/email_service.py`)

- ✅ 使用 MoeMail API 创建邮箱 (`/api/emails/generate`)
- ✅ 通过 MoeMail API 查询邮件 (`/api/emails/{emailId}`)
- ✅ 自动提取验证码（支持多种格式）
- ✅ 正确处理加密的 API key

### 2. 加密工具 (`utils/crypto.py`)

- ✅ 实现 AES-256-GCM 解密
- ✅ 与前端加密格式兼容
- ✅ 支持环境变量配置加密密钥

### 3. 依赖更新

新增依赖：
- `cryptography>=42.0.0` - 加密解密
- `requests>=2.31.0` - HTTP 请求

## 配置步骤

### 1. 配置邮箱提供商

在 Web 界面中：
1. 进入 "设置 > 邮箱提供商"
2. 点击 "添加提供商"
3. 填写信息：
   - **类型**: moemail
   - **名称**: 自定义名称
   - **API URL**: MoeMail 服务地址（如 `https://moemail.example.com`）
   - **API Key**: MoeMail 的 X-API-Key
   - **设为默认**: 勾选（如果是唯一提供商）

### 2. 配置环境变量

在 `.env` 或环境中设置：

```bash
# 数据加密密钥（必须与 Web 应用一致）
ARM_DATA_ENCRYPTION_KEY=your-encryption-key-here

# 或使用 session secret
ARM_SESSION_SECRET=your-session-secret-here
```

**重要**: 加密密钥必须与 Web 应用使用的密钥一致，否则无法解密 API key。

### 3. 启动服务

```bash
# 使用 Docker Compose
docker-compose up -d

# 或手动启动
cd services/worker
pip install -r requirements.txt
python main.py
```

## MoeMail API 调用流程

### 创建邮箱

```
POST /api/emails/generate
Headers:
  X-API-Key: {api_key}
  Content-Type: application/json
Body:
  {
    "expiryTime": 0,
    "domain": "example.com"
  }
Response:
  {
    "email": "user@example.com",
    "id": "email_id_123"
  }
```

### 查询邮件

```
GET /api/emails/{emailId}
Headers:
  X-API-Key: {api_key}
Response:
  {
    "messages": [
      {
        "id": "msg_123",
        "from": "noreply@openai.com",
        "subject": "Verify your email",
        "text": "Your verification code is: 123456",
        "timestamp": 1234567890
      }
    ]
  }
```

## 验证码提取

支持以下格式：
- `verification code is: 123456`
- `code: 123456`
- `Your code is 123456`
- 邮件正文中的独立 6 位数字
- 邮件主题中的 6 位数字

## 故障排查

### 1. 无法创建邮箱

**错误**: `没有可用的邮箱提供商`

**解决**:
- 检查是否已在 Web 界面配置邮箱提供商
- 确认提供商状态为 `active`
- 查看数据库: `SELECT * FROM email_providers WHERE deleted_at IS NULL;`

### 2. API key 解密失败

**错误**: `解密 API key 失败`

**解决**:
- 确认 `ARM_DATA_ENCRYPTION_KEY` 环境变量已设置
- 确认密钥与 Web 应用使用的密钥一致
- 检查 API key 是否正确加密存储

### 3. MoeMail API 调用失败

**错误**: `MoeMail API error: 401` 或 `403`

**解决**:
- 检查 API key 是否正确
- 确认 MoeMail 服务可访问
- 查看 Worker 日志: `docker-compose logs worker`

### 4. 未收到验证码

**可能原因**:
- 邮件延迟（等待时间默认 120 秒）
- MoeMail 服务未正确接收邮件
- 验证码格式不匹配

**解决**:
- 检查 MoeMail 界面是否收到邮件
- 查看 Worker 日志中的邮件内容
- 如需要，调整验证码正则表达式

## 测试

### 1. 测试邮箱创建

```bash
curl -X POST http://localhost:8001/api/payment-registration \
  -H "Content-Type: application/json" \
  -d '{
    "email_provider_id": null,
    "proxy_url": null,
    "max_retries": 1
  }'
```

### 2. 查看任务状态

```bash
curl http://localhost:8001/api/tasks/{task_id}
```

### 3. 查看日志

```bash
# Worker 日志
docker-compose logs -f worker

# 查看特定任务的日志
docker-compose logs worker | grep "task_id"
```

## 性能优化

### 1. 邮件查询间隔

当前每 3 秒查询一次，可根据需要调整：

```python
# utils/email_service.py
time.sleep(3)  # 修改此值
```

### 2. 超时时间

默认 120 秒，可在创建任务时指定：

```json
{
  "max_retries": 3
}
```

### 3. 并发处理

使用 FastAPI BackgroundTasks，支持多个任务并发执行。

## 安全建议

1. **加密密钥管理**:
   - 使用强随机密钥
   - 不要在代码中硬编码
   - 定期轮换密钥

2. **API Key 保护**:
   - 限制 MoeMail API key 权限
   - 定期审计 API 调用日志
   - 使用 HTTPS 通信

3. **数据库安全**:
   - 使用强密码
   - 限制网络访问
   - 定期备份

## 下一步

可以考虑的改进：
1. 添加 WebSocket 实时推送任务状态
2. 实现任务队列（Celery）处理大量并发
3. 添加更详细的监控和告警
4. 支持更多邮箱服务提供商
5. 实现邮箱池管理和复用
