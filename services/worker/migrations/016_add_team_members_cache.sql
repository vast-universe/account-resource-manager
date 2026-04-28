-- 缓存 Team 成员数量和最近一次成员列表，避免账号列表页每次打开都请求 ChatGPT。

ALTER TABLE chatgpt_accounts
ADD COLUMN IF NOT EXISTS team_member_count INTEGER,
ADD COLUMN IF NOT EXISTS team_members JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS team_members_refreshed_at TIMESTAMPTZ;

COMMENT ON COLUMN chatgpt_accounts.team_member_count IS '最近一次查询到的母号 Team 成员数量';
COMMENT ON COLUMN chatgpt_accounts.team_members IS '最近一次查询到的母号 Team 成员列表';
COMMENT ON COLUMN chatgpt_accounts.team_members_refreshed_at IS 'Team 成员缓存刷新时间';

CREATE INDEX IF NOT EXISTS idx_chatgpt_accounts_team_member_count
ON chatgpt_accounts(team_member_count)
WHERE deleted_at IS NULL AND team_member_count IS NOT NULL;
