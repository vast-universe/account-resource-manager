-- ChatGPT Teams 管理表
CREATE TABLE IF NOT EXISTS chatgpt_teams (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    public_id UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,

    -- Team 母号信息
    mother_account_id BIGINT NOT NULL REFERENCES chatgpt_accounts(id) ON DELETE CASCADE,

    -- Team 名称
    name TEXT NOT NULL,

    -- 最大邀请数量
    max_invites INTEGER NOT NULL DEFAULT 5,

    -- Team 状态
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),

    -- 时间戳
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,

    CONSTRAINT uq_team_mother_account UNIQUE (mother_account_id)
);

-- Team 邀请记录表
CREATE TABLE IF NOT EXISTS team_invitations (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    public_id UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,

    -- Team ID
    team_id BIGINT NOT NULL REFERENCES chatgpt_teams(id) ON DELETE CASCADE,

    -- 被邀请的账号
    invited_account_id BIGINT NOT NULL REFERENCES chatgpt_accounts(id) ON DELETE CASCADE,

    -- 邀请状态
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'accepted', 'failed')),

    -- 错误信息
    error_message TEXT,

    -- 时间戳
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_team_invitation UNIQUE (team_id, invited_account_id)
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_chatgpt_teams_mother_account
    ON chatgpt_teams(mother_account_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_chatgpt_teams_status
    ON chatgpt_teams(status) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_team_invitations_team
    ON team_invitations(team_id);

CREATE INDEX IF NOT EXISTS idx_team_invitations_account
    ON team_invitations(invited_account_id);

CREATE INDEX IF NOT EXISTS idx_team_invitations_status
    ON team_invitations(status);

-- 触发器：自动更新 updated_at
CREATE OR REPLACE FUNCTION update_chatgpt_teams_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_chatgpt_teams_updated_at
    BEFORE UPDATE ON chatgpt_teams
    FOR EACH ROW
    EXECUTE FUNCTION update_chatgpt_teams_updated_at();

CREATE TRIGGER trigger_team_invitations_updated_at
    BEFORE UPDATE ON team_invitations
    FOR EACH ROW
    EXECUTE FUNCTION update_chatgpt_teams_updated_at();

COMMENT ON TABLE chatgpt_teams IS 'ChatGPT Team 配置表';
COMMENT ON TABLE team_invitations IS 'Team 邀请记录表';
