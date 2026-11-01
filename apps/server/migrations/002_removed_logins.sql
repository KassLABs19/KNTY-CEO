-- A cancelled invite or removed login keeps its row (the audit log may point at it)
-- but can never sign in. Inviting the person again reuses the row.
ALTER TABLE users DROP CONSTRAINT users_status_check;
ALTER TABLE users ADD CONSTRAINT users_status_check CHECK (status IN ('invited', 'active', 'suspended', 'removed'));
