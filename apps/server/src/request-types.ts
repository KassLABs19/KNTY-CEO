import { DEFAULT_REQUEST_TYPES, type Module, type RequestTypeConfig, type StepConfig } from '@ceo/shared';
import type { Tx } from './db.js';

interface TypeRow {
  key: string;
  name: string;
  module: Module;
  active: boolean;
  steps: StepConfig[];
  reauth: boolean;
  delegable: boolean;
  bulk_allowed: boolean;
  lock_when_approved: boolean;
}

function toConfig(r: TypeRow): RequestTypeConfig {
  return {
    key: r.key, name: r.name, module: r.module, active: r.active, steps: r.steps,
    reauth: r.reauth, delegable: r.delegable, bulkAllowed: r.bulk_allowed, lockWhenApproved: r.lock_when_approved,
  };
}

export async function loadType(tx: Tx, key: string): Promise<RequestTypeConfig | null> {
  const row = (await tx.query<TypeRow>('SELECT * FROM request_types WHERE key = $1', [key])).rows[0];
  return row ? toConfig(row) : null;
}

export async function listTypes(tx: Tx): Promise<RequestTypeConfig[]> {
  return (await tx.query<TypeRow>('SELECT * FROM request_types ORDER BY name')).rows.map(toConfig);
}

/** Caches request types for one transaction, for lists that touch many requests. */
export function typeCache(tx: Tx): (key: string) => Promise<RequestTypeConfig | null> {
  const cache = new Map<string, Promise<RequestTypeConfig | null>>();
  return (key) => {
    if (!cache.has(key)) cache.set(key, loadType(tx, key));
    return cache.get(key)!;
  };
}

/** A name to show for a kind, even when nobody has set it up yet. */
export function typeName(type: RequestTypeConfig | null, key: string): string {
  return type?.name ?? key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

export async function saveType(tx: Tx, companyId: string, t: RequestTypeConfig, by: string | null): Promise<void> {
  await tx.query(
    `INSERT INTO request_types (company_id, key, name, module, active, steps, reauth, delegable, bulk_allowed, lock_when_approved, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (company_id, key) DO UPDATE SET name = $3, module = $4, active = $5, steps = $6, reauth = $7, delegable = $8,
       bulk_allowed = $9, lock_when_approved = $10, updated_by = $11, updated_at = now()`,
    [companyId, t.key, t.name.trim(), t.module, t.active, JSON.stringify(t.steps), t.reauth, t.delegable, t.bulkAllowed, t.lockWhenApproved, by],
  );
}

/** Gives a new company the starting request types, pointing at its own built-in roles. */
export async function seedDefaultTypes(tx: Tx, companyId: string): Promise<void> {
  const roles = new Map((await tx.query<{ id: string; key: string }>('SELECT id, key FROM roles WHERE company_id = $1 AND key IS NOT NULL', [companyId])).rows.map((r) => [r.key, r.id]));
  for (const d of DEFAULT_REQUEST_TYPES) {
    const steps = d.steps.filter((s) => roles.has(s.role)).map((s) => ({ roleId: roles.get(s.role)!, label: s.label, aboveMinor: s.aboveMinor }));
    await saveType(tx, companyId, { ...d, steps, active: d.active && steps.length > 0 }, null);
  }
}
