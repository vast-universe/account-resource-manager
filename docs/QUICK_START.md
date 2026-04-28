# 快速开始指南

## 1. 配置邮箱提供商 (Web 界面)

```
设置 > 邮箱提供商 > 添加提供商

类型: moemail
名称: MoeMail
API URL: https://your-moemail-instance.com
API Key: your-api-key-here
设为默认: ✓
```

## 2. 配置环境变量

```bash
# 必须与 Web 应用一致！
export ARM_DATA_ENCRYPTION_KEY="your-encryption-key"
```

## 3. 测试配置

```bash
cd services/worker
python test_config.py
```

## 4. 启动服务

```bash
# 方式 1: Docker Compose (推荐)
docker-compose up -d

# 方式 2: 手动启动
cd services/worker
pip install -r requirements.txt
python main.py
```

## 5. 使用支付注册

```
Web 界面 > ChatGPT 账号 > 支付注册
```

## 常见问题

### Q: 解密失败？
A: 确认 `ARM_DATA_ENCRYPTION_KEY` 与 Web 应用一致

### Q: 找不到邮箱提供商？
A: 在 Web 界面添加 MoeMail 提供商

### Q: MoeMail API 401？
A: 检查 API Key 是否正确

### Q: 未收到验证码？
A: 检查 MoeMail 界面和 Worker 日志

## 查看日志

```bash
# Worker 日志
docker-compose logs -f worker

# 特定任务
docker-compose logs worker | grep "task_id"
```

## 测试 API

```bash
# 创建任务
curl -X POST http://localhost:8001/api/payment-registration \
  -H "Content-Type: application/json" \
  -d '{"max_retries": 1}'

# 查询状态
curl http://localhost:8001/api/tasks/{task_id}

# 健康检查
curl http://localhost:8001/health
```

## 文档

- [完整集成说明](./INTEGRATION.md)
- [MoeMail 集成](./MOEMAIL_INTEGRATION.md)
- [更新总结](./MOEMAIL_UPDATE_SUMMARY.md)
