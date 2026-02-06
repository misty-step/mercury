-- 0004: Add index on api_keys.key_hash for authentication performance
-- Without this index, every authenticated request requires a full table scan

CREATE INDEX idx_api_keys_key_hash ON api_keys(key_hash);
