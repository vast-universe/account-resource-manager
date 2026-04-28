# 地区和订阅类型功能更新总结

## 更新内容

### 1. 数据库迁移

#### 地区字段 (009_add_region_field.sql)
- 添加 `region` 字段到 `chatgpt_accounts` 表
- 类型: VARCHAR(50)
- 用途: 存储账号注册地区（如 US, DE, GB 等）

#### 订阅类型字段 (010_add_subscription_type_field.sql)
- 添加 `subscription_type` 字段到 `chatgpt_accounts` 表
- 类型: VARCHAR(50)
- 可选值: `free`, `plus`, `team`, `plus_team`

### 2. 后端更新

#### payment_registration_engine.py
- `PaymentRegistrationResult` 添加 `region` 字段
- 注册流程中获取用户地区信息（从 OpenAI API）
- 返回结果包含地区信息

#### main.py
- `save_account_to_db` 函数更新，保存 `region` 字段到数据库
- 支付注册时自动记录账号地区

### 3. 前端更新

#### page.tsx (ChatGPT 账号管理页面)
- `ChatGPTAccount` 接口添加 `region` 和 `subscription_type` 字段
- 表格新增"地区"列：
  - 显示国旗图标和地区代码
  - 支持常见地区：美国🇺🇸、德国🇩🇪、英国🇬🇧、法国🇫🇷、日本🇯🇵等
  - 鼠标悬停显示完整地区名称
- 表格新增"订阅类型"列：
  - Free: 灰色文本
  - Plus: 金色徽章 ⚡ Plus
  - Team: 绿色徽章 👥 Team
  - Plus + Team: 两个徽章垂直排列

## 工作流程

### 支付注册流程
1. 用户创建支付注册任务
2. 系统注册 ChatGPT 账号
3. 获取用户信息（包括地区）
4. 创建 Plus 和 Team 支付链接
5. **自动保存地区到数据库**
6. 前端表格显示地区和订阅状态

### 订阅类型更新
支付成功后，需要手动或通过 webhook 更新订阅类型：

```sql
-- 单个订阅
UPDATE chatgpt_accounts 
SET subscription_type = 'plus' 
WHERE email = 'user@example.com';

-- 双订阅
UPDATE chatgpt_accounts 
SET subscription_type = 'plus_team' 
WHERE email = 'user@example.com';
```

## 部署步骤

1. 运行数据库迁移：
   ```bash
   psql -d your_database -f services/worker/migrations/009_add_region_field.sql
   psql -d your_database -f services/worker/migrations/010_add_subscription_type_field.sql
   ```

2. 重启 worker 服务（应用后端代码更新）

3. 重启前端应用（应用表格更新）

4. 验证：创建新的支付注册任务，检查地区是否自动保存

## 注意事项

- 地区信息从 OpenAI API 自动获取，无需手动输入
- 如果获取失败，默认使用 "US"
- 订阅类型需要在支付成功后手动更新（或通过 webhook 自动更新）
- 旧账号的地区字段为 NULL，可以通过重新登录或手动更新来填充
