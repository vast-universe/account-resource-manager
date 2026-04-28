-- 添加日志字段到 registration_tasks 表
ALTER TABLE registration_tasks
ADD COLUMN IF NOT EXISTS logs TEXT[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS progress TEXT DEFAULT '0/0';

COMMENT ON COLUMN registration_tasks.logs IS '任务执行日志';
COMMENT ON COLUMN registration_tasks.progress IS '任务进度';
