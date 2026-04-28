-- 记录账号作为母号创建的 Team workspace ID。
-- 这个字段用于后续查询该 Team 的成员列表，避免从多个可访问 workspace 中猜测母号空间。

ALTER TABLE chatgpt_accounts
ADD COLUMN IF NOT EXISTS team_workspace_id TEXT;

COMMENT ON COLUMN chatgpt_accounts.team_workspace_id IS '账号作为母号创建的 Team workspace ID';

CREATE INDEX IF NOT EXISTS idx_chatgpt_accounts_team_workspace_id
ON chatgpt_accounts(team_workspace_id)
WHERE deleted_at IS NULL AND team_workspace_id IS NOT NULL;

-- 对历史数据做保守回填：只有账号恰好有 1 个 team workspace 时才写入，避免误判被邀请空间。
UPDATE chatgpt_accounts
SET team_workspace_id = team_workspace.workspace_id
FROM (
  SELECT
    id,
    team_items.items->>0 AS workspace_json,
    (team_items.items->0)->>'workspace_id' AS workspace_id
  FROM (
    SELECT
      a.id,
      jsonb_agg(w.item) AS items
    FROM chatgpt_accounts a
    CROSS JOIN LATERAL jsonb_array_elements(a.workspace_tokens) AS w(item)
    WHERE a.team_workspace_id IS NULL
      AND a.workspace_tokens IS NOT NULL
      AND a.workspace_tokens != '[]'::jsonb
      AND w.item->>'plan_type' = 'team'
      AND w.item->>'workspace_id' IS NOT NULL
    GROUP BY a.id
    HAVING COUNT(*) = 1
  ) team_items
) team_workspace
WHERE chatgpt_accounts.id = team_workspace.id
  AND chatgpt_accounts.team_workspace_id IS NULL;
