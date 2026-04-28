# 邮箱提供商默认设置功能说明

## 功能概述

系统支持配置多个邮箱提供商，并可以设置其中一个为"默认提供商"。当其他功能（如支付注册）需要创建邮箱时，会自动使用默认提供商。

## 工作原理

### 1. 前端配置

在 **设置 > 邮箱提供商** 页面：

- ✅ 显示"默认"标签（蓝色 Tag）
- ✅ 添加/编辑时有"设为默认"开关
- ✅ 表格中显示哪个是默认提供商

**界面元素**:
```typescript
// 表格列
{
  title: "默认",
  dataIndex: "is_default",
  render: (isDefault: boolean) =>
    isDefault ? <Tag color="blue">默认</Tag> : null,
}

// 表单字段
<Form.Item
  label="设为默认"
  name="is_default"
  valuePropName="checked"
  initialValue={false}
>
  <Switch />
</Form.Item>
```

### 2. 后端选择逻辑

在 Worker 服务中，`EmailServiceAdapter` 会自动选择提供商：

```python
# services/worker/utils/email_service.py

def _get_provider(self) -> Dict[str, Any]:
    """获取邮箱提供商配置"""
    
    # 如果指定了 email_provider_id，使用该提供商
    if self.email_provider_id:
        cursor.execute("""
            SELECT id, api_url, api_key_ciphertext, provider_type
            FROM email_providers
            WHERE id = %s AND deleted_at IS NULL
        """, (self.email_provider_id,))
    else:
        # 否则自动选择默认提供商
        cursor.execute("""
            SELECT id, api_url, api_key_ciphertext, provider_type
            FROM email_providers
            WHERE deleted_at IS NULL AND status = 'active'
            ORDER BY is_default DESC, created_at DESC
            LIMIT 1
        """)
```

**选择优先级**:
1. 如果明确指定了 `email_provider_id`，使用指定的提供商
2. 否则，按以下顺序选择：
   - ✅ `is_default = true` 的提供商（优先）
   - ✅ 如果有多个默认提供商，选择最新创建的
   - ✅ 如果没有默认提供商，选择最新创建的活跃提供商

### 3. 数据库表结构

```sql
CREATE TABLE email_providers (
  id BIGINT PRIMARY KEY,
  provider_type TEXT,
  name TEXT,
  api_url TEXT,
  api_key_ciphertext TEXT,
  status TEXT DEFAULT 'active',
  is_default BOOLEAN DEFAULT false,  -- 默认标志
  created_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ
);

-- 索引
CREATE INDEX idx_email_providers_default 
  ON email_providers (is_default);
```

## 使用场景

### 场景 1: 支付注册（自动使用默认）

```typescript
// 前端调用
const res = await fetch("/api/chatgpt/payment-registration", {
  method: "POST",
  body: JSON.stringify({
    // 不指定 email_provider_id，自动使用默认
    proxy_url: "http://127.0.0.1:7890",
    max_retries: 3
  })
});
```

```python
# Worker 服务
email_service = EmailServiceAdapter(
    database_url=DATABASE_URL,
    email_provider_id=None  # None 表示使用默认
)
```

### 场景 2: 指定特定提供商

```typescript
// 前端调用
const res = await fetch("/api/chatgpt/payment-registration", {
  method: "POST",
  body: JSON.stringify({
    email_provider_id: 2,  // 指定使用 ID 为 2 的提供商
    proxy_url: null,
    max_retries: 3
  })
});
```

## 配置步骤

### 1. 添加邮箱提供商

访问 http://localhost:3000/settings/email-providers

点击"添加提供商"，填写：
- **类型**: moemail
- **名称**: MoeMail 主服务
- **描述**: 主要的邮箱服务
- **API URL**: https://moemail.example.com
- **API Key**: your-api-key
- **状态**: 启用
- **设为默认**: ✅ 开启

### 2. 查看默认提供商

在提供商列表中，默认提供商会显示蓝色的"默认"标签。

### 3. 更改默认提供商

1. 编辑当前默认提供商，关闭"设为默认"
2. 编辑要设为默认的提供商，开启"设为默认"

或者：
- 直接编辑新的提供商，开启"设为默认"
- 系统会自动处理（建议在后端实现自动取消其他默认）

## 建议改进

### 改进 1: 自动取消其他默认

当设置一个提供商为默认时，自动取消其他提供商的默认状态。

**后端实现** (`apps/web/src/lib/email-providers/repository.ts`):

```typescript
export async function updateEmailProvider(
  id: number,
  input: UpdateEmailProviderInput
): Promise<EmailProvider | null> {
  const pool = getMailboxDbPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 如果设置为默认，先取消其他提供商的默认状态
    if (input.is_default === true) {
      await client.query(
        `UPDATE email_providers 
         SET is_default = false 
         WHERE id != $1 AND deleted_at IS NULL`,
        [id]
      );
    }

    // 更新当前提供商
    const result = await client.query(
      `UPDATE email_providers
       SET name = COALESCE($1, name),
           api_url = COALESCE($2, api_url),
           is_default = COALESCE($3, is_default),
           status = COALESCE($4, status),
           updated_at = NOW()
       WHERE id = $5 AND deleted_at IS NULL
       RETURNING *`,
      [input.name, input.api_url, input.is_default, input.status, id]
    );

    await client.query("COMMIT");
    return result.rows[0] || null;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
```

### 改进 2: 前端提示

当用户设置默认提供商时，显示提示信息。

```typescript
const handleSubmit = async (values: any) => {
  if (values.is_default) {
    Modal.confirm({
      title: "设为默认提供商",
      content: "设置后，其他功能将自动使用此提供商创建邮箱。确定继续？",
      onOk: async () => {
        await saveProvider(values);
      }
    });
  } else {
    await saveProvider(values);
  }
};
```

### 改进 3: 默认提供商不可删除

防止误删除默认提供商。

```typescript
const handleDelete = async (id: string, isDefault: boolean) => {
  if (isDefault) {
    message.warning("默认提供商不可删除，请先设置其他提供商为默认");
    return;
  }
  
  // 执行删除...
};
```

### 改进 4: 显示使用统计

在提供商列表中显示：
- 已创建邮箱数
- 最后使用时间
- 成功率

```typescript
{
  title: "使用情况",
  key: "usage",
  render: (_, record) => (
    <Space direction="vertical" size="small">
      <Text type="secondary">
        已创建: {record.total_mailboxes_created} 个
      </Text>
      {record.last_used_at && (
        <Text type="secondary">
          最后使用: {new Date(record.last_used_at).toLocaleString()}
        </Text>
      )}
    </Space>
  )
}
```

## 测试

### 1. 测试默认选择

```bash
# 查询当前默认提供商
psql $DATABASE_URL -c "
  SELECT id, name, is_default, status 
  FROM email_providers 
  WHERE deleted_at IS NULL 
  ORDER BY is_default DESC;
"
```

### 2. 测试支付注册

```bash
# 不指定提供商，应该使用默认
curl -X POST http://localhost:8001/api/payment-registration \
  -H "Content-Type: application/json" \
  -d '{
    "max_retries": 1
  }'
```

### 3. 查看日志

```bash
# Worker 日志会显示使用的提供商
docker-compose logs worker | grep "使用域名"
```

## 常见问题

### Q: 如果没有设置默认提供商会怎样？

A: 系统会自动选择最新创建的活跃提供商。

### Q: 可以有多个默认提供商吗？

A: 数据库允许，但建议只设置一个。查询时会选择最新的默认提供商。

### Q: 如何查看哪个是默认提供商？

A: 
1. 前端：访问设置页面，查看蓝色"默认"标签
2. 数据库：`SELECT * FROM email_providers WHERE is_default = true;`

### Q: 支付注册可以指定非默认提供商吗？

A: 可以，在前端弹窗中选择特定的提供商 ID。

## 相关文档

- [MoeMail 集成说明](./MOEMAIL_INTEGRATION.md)
- [数据库表设计](./DATABASE_SCHEMA.md)
- [快速开始指南](./QUICK_START.md)
