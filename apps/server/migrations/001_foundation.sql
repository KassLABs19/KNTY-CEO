-- KNTY CEO foundation: companies, roles, people (from the HR system), logins, sessions,
-- settings, approval requests and steps, delegations, partner systems, the outbox and
-- inbox for messages between systems, notifications and the append-only audit log.
-- Every company-owned table has row-level security, so one company can never read or
-- change another company's rows.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION app_company_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.company_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app_bypass_rls() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('app.bypass_rls', true), '') = 'on'
$$;

CREATE TABLE companies (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE roles (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  -- Built-in roles have a stable key that approval chains point at; custom roles have none.
  key           text CHECK (key IN ('ceo', 'cfo', 'hr_head', 'ops_head', 'dept_head', 'admin')),
  name          text NOT NULL,
  scope         text NOT NULL CHECK (scope IN ('company', 'department', 'team')),
  requires_2fa  boolean NOT NULL DEFAULT false,
  -- { "<module>": 0..3 }  0 none, 1 view, 2 approve, 3 manage
  levels        jsonb NOT NULL DEFAULT '{}',
  is_system     boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, name)
);
CREATE UNIQUE INDEX roles_key_unique ON roles (company_id, key) WHERE key IS NOT NULL;

-- People come from the HR system, which owns them. Name, email, department and exit
-- are only ever changed by HR system messages, never edited here.
CREATE TABLE people (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id        text NOT NULL,
  full_name          text NOT NULL,
  email              text NOT NULL,
  department         text,
  job_title          text,
  left_on            date,
  needs_role_review  boolean NOT NULL DEFAULT false,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, employee_id)
);

-- A login for one person. Only people who exist in the HR system can have one.
CREATE TABLE users (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  person_id        uuid NOT NULL UNIQUE REFERENCES people(id) ON DELETE CASCADE,
  email            text NOT NULL,
  role_id          uuid NOT NULL REFERENCES roles(id),
  is_owner         boolean NOT NULL DEFAULT false,
  status           text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'active', 'suspended')),
  password_hash    text,
  failed_attempts  int NOT NULL DEFAULT 0,
  locked_at        timestamptz,
  totp_secret      text,
  totp_enabled     boolean NOT NULL DEFAULT false,
  last_login_at    timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_unique ON users (lower(email));
CREATE INDEX users_company ON users (company_id);

CREATE TABLE invites (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_by  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_hash  text NOT NULL UNIQUE,
  app_version   text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz
);
CREATE INDEX sessions_user ON sessions (user_id);

CREATE TABLE settings (
  company_id  uuid PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  rules       jsonb NOT NULL,
  locale      jsonb NOT NULL DEFAULT '{"numberLocale":"en-GB","dateStyle":"medium","timeZone":"UTC"}',
  updated_by  uuid REFERENCES users(id),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- The HR system and Predicto. Each has its own secrets: one to check messages it sends
-- here, one to sign messages sent to it.
CREATE TABLE partners (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  system             text NOT NULL CHECK (system IN ('hr', 'predicto')),
  name               text NOT NULL,
  base_url           text,
  inbound_secret     text NOT NULL,
  outbound_secret    text NOT NULL,
  contract_version   text,
  last_message_at    timestamptz,
  last_reconcile     jsonb,
  UNIQUE (company_id, system)
);

CREATE SEQUENCE request_ref_seq START 1001;

CREATE TABLE requests (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id             uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  ref                    text NOT NULL DEFAULT ('A-' || nextval('request_ref_seq')),
  system                 text NOT NULL CHECK (system IN ('hr', 'predicto')),
  external_id            text NOT NULL,
  kind                   text NOT NULL CHECK (kind IN ('leave', 'payroll', 'hire', 'expense', 'refund', 'manual_payment')),
  version                int NOT NULL,
  title                  text NOT NULL,
  subtitle               text NOT NULL DEFAULT '',
  requester_employee_id  text,
  requester_user_id      uuid REFERENCES users(id),
  department             text,
  amount_minor           bigint,
  currency               char(3),
  facts                  jsonb NOT NULL DEFAULT '[]',
  masked                 jsonb NOT NULL DEFAULT '[]',
  partner_steps          jsonb NOT NULL DEFAULT '[]',
  bulk_eligible          boolean NOT NULL DEFAULT false,
  trace_id               text NOT NULL,
  status                 text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'returned', 'cancelled')),
  current_step           int NOT NULL DEFAULT 0,
  step_started_at        timestamptz NOT NULL DEFAULT now(),
  reminded_at            timestamptz,
  escalated_at           timestamptz,
  changed_upstream       boolean NOT NULL DEFAULT false,
  locked                 boolean NOT NULL DEFAULT false,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, system, external_id)
);
CREATE INDEX requests_company_status ON requests (company_id, status, updated_at DESC);

-- The Control Center's own steps for the current version of a request.
CREATE TABLE request_steps (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  request_id    uuid NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  position      int NOT NULL,
  role_key      text NOT NULL,
  label         text NOT NULL,
  state         text NOT NULL CHECK (state IN ('done', 'now', 'later', 'rejected', 'returned')),
  decided_by    uuid REFERENCES users(id),
  on_behalf_of  uuid REFERENCES users(id),
  decided_at    timestamptz,
  note          text,
  UNIQUE (request_id, position)
);

CREATE TABLE request_events (
  id          bigserial PRIMARY KEY,
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  request_id  uuid NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  at          timestamptz NOT NULL DEFAULT now(),
  actor_id    uuid REFERENCES users(id),
  what        text NOT NULL
);
CREATE INDEX request_events_request ON request_events (request_id, at);

CREATE TABLE delegations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  from_user_id  uuid NOT NULL REFERENCES users(id),
  to_user_id    uuid NOT NULL REFERENCES users(id),
  starts_at     timestamptz NOT NULL DEFAULT now(),
  ends_at       timestamptz NOT NULL,
  ended_at      timestamptz,
  created_by    uuid REFERENCES users(id),
  CHECK (from_user_id <> to_user_id),
  CHECK (ends_at > starts_at)
);

-- Messages to partners are written here in the same transaction as the change, then
-- delivered and retried by a worker until the partner confirms them.
CREATE TABLE outbox (
  id            bigserial PRIMARY KEY,
  company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  system        text NOT NULL,
  message_id    text NOT NULL UNIQUE,
  trace_id      text NOT NULL,
  payload       jsonb NOT NULL,
  attempts      int NOT NULL DEFAULT 0,
  next_try_at   timestamptz NOT NULL DEFAULT now(),
  delivered_at  timestamptz,
  last_error    text,
  alerted_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX outbox_due ON outbox (next_try_at) WHERE delivered_at IS NULL;

-- Messages already received from partners, so a retry is never applied twice.
CREATE TABLE inbox (
  company_id   uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  system       text NOT NULL,
  message_id   text NOT NULL,
  received_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, system, message_id)
);

CREATE TABLE notifications (
  id          bigserial PRIMARY KEY,
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        text NOT NULL,
  text        text NOT NULL,
  request_id  uuid REFERENCES requests(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  read_at     timestamptz
);
CREATE INDEX notifications_user ON notifications (user_id, created_at DESC);

CREATE TABLE audit_log (
  id             bigserial PRIMARY KEY,
  company_id     uuid REFERENCES companies(id) ON DELETE CASCADE,
  actor_user_id  uuid REFERENCES users(id),
  on_behalf_of   uuid REFERENCES users(id),
  action         text NOT NULL,
  category       text NOT NULL DEFAULT 'other',
  target_type    text,
  target_id      text,
  trace_id       text,
  detail         jsonb NOT NULL DEFAULT '{}',
  ip             text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_company_time ON audit_log (company_id, created_at DESC);

-- The audit log can only grow: no edits, no deletes, for anyone.
CREATE OR REPLACE FUNCTION audit_log_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'The audit log cannot be changed or deleted';
END;
$$;
CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();

-- Row-level security on every company-owned table.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['roles', 'people', 'users', 'invites', 'sessions', 'settings', 'partners', 'requests', 'request_steps',
                           'request_events', 'delegations', 'outbox', 'inbox', 'notifications', 'audit_log'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY company_isolation ON %I USING (app_bypass_rls() OR company_id = app_company_id()) WITH CHECK (app_bypass_rls() OR company_id = app_company_id())',
      t);
  END LOOP;
END;
$$;
