# 订阅类型字段说明

## 数据库字段

- **字段名**: `subscription_type`
- **类型**: VARCHAR(50)
- **可选值**:
  - `free` - 免费账号（默认）
  - `plus` - 已订阅 Plus
  - `team` - 已订阅 Team
  - `plus_team` - 同时订阅 Plus 和 Team

## 前端显示

订阅类型列会显示：
- **Free**: 灰色文本，表示免费账号
- **Plus**: 金色徽章 ⚡ Plus
- **Team**: 绿色徽章 👥 Team
- **Plus + Team**: 两个徽章垂直排列

## 更新订阅类型

### 方式1: 通过 API 更新

```sql
-- 更新为 Plus
UPDATE chatgpt_accounts 
SET subscription_type = 'plus' 
WHERE email = 'user@example.com';

-- 更新为 Team
UPDATE chatgpt_accounts 
SET subscription_type = 'team' 
WHERE email = 'user@example.com';

-- 更新为 Plus + Team
UPDATE chatgpt_accounts 
SET subscription_type = 'plus_team' 
WHERE email = 'user@example.com';
```

### 方式2: 根据支付状态自动更新

可以创建一个定时任务或触发器，根据 `payment_status` 和支付链接的存在来自动更新订阅类型：

```sql
-- 示例：根据支付链接和支付状态更新订阅类型
UPDATE chatgpt_accounts
SET subscription_type = CASE
  WHEN checkout_url IS NOT NULL AND team_checkout_url IS NOT NULL AND payment_status = 'paid' THEN 'plus_team'
  WHEN checkout_url IS NOT NULL AND payment_status = 'paid' THEN 'plus'
  WHEN team_checkout_url IS NOT NULL AND payment_status = 'paid' THEN 'team'
  ELSE 'free'
END
WHERE payment_status = 'paid';
```

## 迁移步骤

1. 运行数据库迁移：
   ```bash
   psql -d your_database -f services/worker/migrations/010_add_subscription_type_field.sql
   ```

2. 重启前端应用以加载新的表格列

3. （可选）批量更新现有账号的订阅类型
