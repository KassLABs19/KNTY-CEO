import type { Tx } from './db.js';

export type AuditCategory = 'approvals' | 'access' | 'logins' | 'security' | 'sensitive' | 'sync' | 'settings' | 'other';

export interface AuditEntry {
  companyId: string | null;
  actorUserId?: string | null;
  onBehalfOf?: string | null;
  action: string;
  category: AuditCategory;
  targetType?: string;
  targetId?: string;
  traceId?: string | null;
  detail?: Record<string, unknown>;
  ip?: string;
}

/** Writes one line to the append-only audit log. Call it inside the same transaction as the change. */
export async function audit(tx: Tx, e: AuditEntry): Promise<void> {
  await tx.query(
    `INSERT INTO audit_log (company_id, actor_user_id, on_behalf_of, action, category, target_type, target_id, trace_id, detail, ip)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      e.companyId,
      e.actorUserId ?? null,
      e.onBehalfOf ?? null,
      e.action,
      e.category,
      e.targetType ?? null,
      e.targetId ?? null,
      e.traceId ?? null,
      JSON.stringify(e.detail ?? {}),
      e.ip ?? null,
    ],
  );
}
