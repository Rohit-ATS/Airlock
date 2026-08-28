-- Forward migration
ALTER TABLE users ADD COLUMN loyalty_tier text NULL;

-- Rollback migration
-- ALTER TABLE users DROP COLUMN loyalty_tier;