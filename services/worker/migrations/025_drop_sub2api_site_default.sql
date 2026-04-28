DROP INDEX IF EXISTS idx_sub2api_sites_default;

ALTER TABLE sub2api_sites
DROP COLUMN IF EXISTS is_default;
