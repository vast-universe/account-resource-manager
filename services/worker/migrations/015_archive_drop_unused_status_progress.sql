-- 归档并移除不再使用的支付状态与 Team 邀请进度数据。
-- 业务逻辑不再依赖 payment_status、chatgpt_teams、team_invitations；
-- 现有数据先写入 archive 表，再从主业务结构中移除。

CREATE TABLE IF NOT EXISTS chatgpt_account_payment_status_archive (
    account_id BIGINT PRIMARY KEY,
    email TEXT NOT NULL,
    payment_status VARCHAR(50),
    archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO chatgpt_account_payment_status_archive (account_id, email, payment_status, archived_at)
SELECT id, email, payment_status, NOW()
FROM chatgpt_accounts
WHERE payment_status IS NOT NULL
ON CONFLICT (account_id) DO UPDATE
SET
    email = EXCLUDED.email,
    payment_status = EXCLUDED.payment_status,
    archived_at = EXCLUDED.archived_at;

CREATE TABLE IF NOT EXISTS chatgpt_teams_archive (
    id BIGINT PRIMARY KEY,
    public_id UUID NOT NULL,
    mother_account_id BIGINT NOT NULL,
    mother_email TEXT,
    name TEXT NOT NULL,
    max_invites INTEGER NOT NULL,
    status TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    deleted_at TIMESTAMPTZ,
    archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO chatgpt_teams_archive (
    id, public_id, mother_account_id, mother_email, name, max_invites, status,
    created_at, updated_at, deleted_at, archived_at
)
SELECT
    t.id,
    t.public_id,
    t.mother_account_id,
    a.email AS mother_email,
    t.name,
    t.max_invites,
    t.status,
    t.created_at,
    t.updated_at,
    t.deleted_at,
    NOW()
FROM chatgpt_teams t
LEFT JOIN chatgpt_accounts a ON a.id = t.mother_account_id
ON CONFLICT (id) DO UPDATE
SET
    public_id = EXCLUDED.public_id,
    mother_account_id = EXCLUDED.mother_account_id,
    mother_email = EXCLUDED.mother_email,
    name = EXCLUDED.name,
    max_invites = EXCLUDED.max_invites,
    status = EXCLUDED.status,
    created_at = EXCLUDED.created_at,
    updated_at = EXCLUDED.updated_at,
    deleted_at = EXCLUDED.deleted_at,
    archived_at = EXCLUDED.archived_at;

CREATE TABLE IF NOT EXISTS team_invitations_archive (
    id BIGINT PRIMARY KEY,
    public_id UUID NOT NULL,
    team_id BIGINT NOT NULL,
    mother_account_id BIGINT,
    mother_email TEXT,
    invited_account_id BIGINT NOT NULL,
    invited_email TEXT,
    status TEXT NOT NULL,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO team_invitations_archive (
    id, public_id, team_id, mother_account_id, mother_email, invited_account_id,
    invited_email, status, error_message, created_at, updated_at, archived_at
)
SELECT
    ti.id,
    ti.public_id,
    ti.team_id,
    t.mother_account_id,
    mother.email AS mother_email,
    ti.invited_account_id,
    invited.email AS invited_email,
    ti.status,
    ti.error_message,
    ti.created_at,
    ti.updated_at,
    NOW()
FROM team_invitations ti
LEFT JOIN chatgpt_teams t ON t.id = ti.team_id
LEFT JOIN chatgpt_accounts mother ON mother.id = t.mother_account_id
LEFT JOIN chatgpt_accounts invited ON invited.id = ti.invited_account_id
ON CONFLICT (id) DO UPDATE
SET
    public_id = EXCLUDED.public_id,
    team_id = EXCLUDED.team_id,
    mother_account_id = EXCLUDED.mother_account_id,
    mother_email = EXCLUDED.mother_email,
    invited_account_id = EXCLUDED.invited_account_id,
    invited_email = EXCLUDED.invited_email,
    status = EXCLUDED.status,
    error_message = EXCLUDED.error_message,
    created_at = EXCLUDED.created_at,
    updated_at = EXCLUDED.updated_at,
    archived_at = EXCLUDED.archived_at;

DROP TABLE IF EXISTS team_invitations;
DROP TABLE IF EXISTS chatgpt_teams;

DROP INDEX IF EXISTS idx_chatgpt_accounts_payment_status;
ALTER TABLE chatgpt_accounts
DROP COLUMN IF EXISTS payment_status;
