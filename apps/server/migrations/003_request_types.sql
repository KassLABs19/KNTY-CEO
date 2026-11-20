-- A modular approval engine: the HR system is the only connected system, and the steps
-- for each kind of request are set by the account owners in Settings › Request types,
-- instead of being written into the code.

-- This migration changes rows in every company, so it runs past row-level security.
SELECT set_config('app.bypass_rls', 'on', true);

CREATE TABLE request_types (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  key                 text NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]{1,39}$'),
  name                text NOT NULL,
  module              text NOT NULL,
  active              boolean NOT NULL DEFAULT true,
  -- [{ "roleId": uuid, "label": text, "aboveMinor": int | null }]
  steps               jsonb NOT NULL DEFAULT '[]',
  reauth              boolean NOT NULL DEFAULT false,
  delegable           boolean NOT NULL DEFAULT true,
  bulk_allowed        boolean NOT NULL DEFAULT false,
  lock_when_approved  boolean NOT NULL DEFAULT false,
  updated_by          uuid REFERENCES users(id),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, key)
);
ALTER TABLE request_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE request_types FORCE ROW LEVEL SECURITY;
CREATE POLICY company_isolation ON request_types
  USING (app_bypass_rls() OR company_id = app_company_id())
  WITH CHECK (app_bypass_rls() OR company_id = app_company_id());

-- Steps point at a role by id, so custom roles can be approvers too.
ALTER TABLE request_steps ADD COLUMN role_id uuid REFERENCES roles(id);
UPDATE request_steps s SET role_id = r.id FROM roles r WHERE r.company_id = s.company_id AND r.key = s.role_key;
DELETE FROM request_steps WHERE role_id IS NULL;
ALTER TABLE request_steps ALTER COLUMN role_id SET NOT NULL;
ALTER TABLE request_steps DROP COLUMN role_key;

-- Any well-formed key may arrive; whether it is routed is decided by request_types.
ALTER TABLE requests DROP CONSTRAINT requests_kind_check;
ALTER TABLE requests ADD CONSTRAINT requests_kind_check CHECK (kind ~ '^[a-z][a-z0-9_]{1,39}$');

-- Remove the second connected system and everything that belonged to it.
DELETE FROM requests WHERE system <> 'hr';
DELETE FROM outbox WHERE system <> 'hr';
DELETE FROM inbox WHERE system <> 'hr';
DELETE FROM partners WHERE system <> 'hr';
ALTER TABLE partners DROP CONSTRAINT partners_system_check;
ALTER TABLE partners ADD CONSTRAINT partners_system_check CHECK (system = 'hr');
ALTER TABLE requests DROP CONSTRAINT requests_system_check;
ALTER TABLE requests ADD CONSTRAINT requests_system_check CHECK (system = 'hr');

-- Access areas that no longer exist.
UPDATE roles SET levels = levels - 'predicto' - 'refunds';

-- Rules now hold only the reminder and escalation hours.
UPDATE settings SET rules = jsonb_build_object(
  'remindAfterHours', coalesce((rules->>'remindAfterHours')::int, 24),
  'escalateAfterHours', coalesce((rules->>'escalateAfterHours')::int, 48));

-- Starting request types for existing companies (the same as a new company gets).
INSERT INTO request_types (company_id, key, name, module, steps, reauth, delegable, bulk_allowed, lock_when_approved)
SELECT c.id, t.key, t.name, t.module,
       coalesce((SELECT jsonb_agg(jsonb_build_object('roleId', r.id, 'label', s.label, 'aboveMinor', NULL) ORDER BY s.pos)
                   FROM (VALUES (1, t.r1, t.l1), (2, t.r2, t.l2)) AS s(pos, role_key, label)
                   JOIN roles r ON r.company_id = c.id AND r.key = s.role_key
                  WHERE s.role_key IS NOT NULL), '[]'),
       t.reauth, t.delegable, false, t.lock_when_approved
  FROM companies c
 CROSS JOIN (VALUES
   ('leave',   'Leave (department heads)', 'leave',   'ceo', 'CEO',                 NULL,  NULL,                  false, true,  false),
   ('payroll', 'Payroll run',              'payroll', 'cfo', 'CFO · signer 1 of 2', 'ceo', 'CEO · signer 2 of 2', true,  false, true),
   ('hire',    'New hire',                 'people',  'cfo', 'CFO',                 'ceo', 'CEO',                 false, true,  false),
   ('expense', 'Expense claim',            'finance', 'cfo', 'CFO',                 NULL,  NULL,                  false, true,  false)
 ) AS t(key, name, module, r1, l1, r2, l2, reauth, delegable, lock_when_approved)
ON CONFLICT (company_id, key) DO NOTHING;

-- Request types that ended up with no steps (their roles were removed) start switched off.
UPDATE request_types SET active = false WHERE steps = '[]';
