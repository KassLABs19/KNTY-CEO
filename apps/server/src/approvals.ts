import { randomUUID } from 'node:crypto';
import {
  CONTRACT_VERSION,
  DEFAULT_RULES,
  KIND_SYSTEM,
  NEVER_DELEGATED,
  consoleChain,
  type ApprovalRules,
  type CancelMessage,
  type Decision,
  type DecisionMessage,
  type Module,
  type RequestKind,
  type RequestMessage,
  type RequestStatus,
  type RoleKey,
} from '@ceo/shared';
import type { Tx } from './db.js';
import type { CurrentUser } from './guard.js';
import { audit } from './audit.js';
import { AppError } from './errors.js';

/** Which access-matrix module covers each kind of request. */
export const KIND_MODULE: Record<RequestKind, Module> = {
  leave: 'leave',
  payroll: 'payroll',
  hire: 'people',
  expense: 'finance',
  refund: 'refunds',
  manual_payment: 'predicto',
};

export const SYSTEM_NAME = { hr: 'HR system', predicto: 'Predicto' } as const;

export interface RequestRow {
  id: string;
  company_id: string;
  ref: string;
  system: 'hr' | 'predicto';
  external_id: string;
  kind: RequestKind;
  version: number;
  title: string;
  subtitle: string;
  requester_user_id: string | null;
  department: string | null;
  amount_minor: string | null;
  currency: string | null;
  facts: { label: string; value: string }[];
  masked: { field: string; ref: string }[];
  partner_steps: { label: string; by: string; at: string }[];
  bulk_eligible: boolean;
  trace_id: string;
  status: RequestStatus;
  current_step: number;
  step_started_at: Date;
  changed_upstream: boolean;
  locked: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface StepRow {
  id: string;
  position: number;
  role_key: RoleKey;
  label: string;
  state: 'done' | 'now' | 'later' | 'rejected' | 'returned';
  decided_by: string | null;
  on_behalf_of: string | null;
  decided_at: Date | null;
  note: string | null;
}

export async function loadRules(tx: Tx): Promise<ApprovalRules> {
  const row = (await tx.query<{ rules: Partial<ApprovalRules> }>('SELECT rules FROM settings')).rows[0];
  return { ...DEFAULT_RULES, ...(row?.rules ?? {}) };
}

export async function loadSteps(tx: Tx, requestId: string): Promise<StepRow[]> {
  return (await tx.query<StepRow>('SELECT * FROM request_steps WHERE request_id = $1 ORDER BY position', [requestId])).rows;
}

export interface Actor {
  userId: string;
  /** Set when acting as someone's delegate. */
  onBehalfOf: string | null;
}

/**
 * Who may decide the current step: the people holding the step's role, plus their active
 * delegates. Never the requester, never someone who already decided an earlier step of
 * this request (so payroll always has two different signers), and never a delegate for
 * kinds that are not delegated (payroll). If the only holder is the requester, the step
 * falls to the account owners instead.
 */
export async function actorsFor(tx: Tx, req: RequestRow, steps: StepRow[]): Promise<Actor[]> {
  const step = steps.find((s) => s.position === req.current_step);
  if (!step || req.status !== 'pending') return [];
  const alreadySigned = new Set(steps.filter((s) => s.decided_by).flatMap((s) => [s.decided_by!, s.on_behalf_of].filter(Boolean) as string[]));
  const excluded = (id: string) => id === req.requester_user_id || alreadySigned.has(id);

  let holders = (await tx.query<{ id: string }>(
    `SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id WHERE r.key = $1 AND u.status = 'active' AND u.locked_at IS NULL`,
    [step.role_key],
  )).rows.map((r) => r.id);
  if (holders.length > 0 && holders.every(excluded)) {
    holders = (await tx.query<{ id: string }>(`SELECT id FROM users WHERE is_owner AND status = 'active' AND locked_at IS NULL`)).rows.map((r) => r.id);
  }
  const actors: Actor[] = holders.filter((id) => !excluded(id)).map((userId) => ({ userId, onBehalfOf: null }));

  if (!NEVER_DELEGATED.includes(req.kind) && holders.length > 0) {
    const delegates = (await tx.query<{ to_user_id: string; from_user_id: string }>(
      `SELECT d.to_user_id, d.from_user_id FROM delegations d JOIN users t ON t.id = d.to_user_id
        WHERE d.from_user_id = ANY($1) AND d.ended_at IS NULL AND d.starts_at <= now() AND d.ends_at > now()
          AND t.status = 'active' AND t.locked_at IS NULL`,
      [holders],
    )).rows;
    for (const d of delegates) {
      // A delegate can't act for someone on a request that person raised, or sign twice.
      if (excluded(d.to_user_id) || d.from_user_id === req.requester_user_id) continue;
      if (!actors.some((a) => a.userId === d.to_user_id)) actors.push({ userId: d.to_user_id, onBehalfOf: d.from_user_id });
    }
  }
  return actors;
}

/** Why this person can't decide the current step, or null when they can. */
export async function blockedReason(tx: Tx, user: CurrentUser, req: RequestRow, steps: StepRow[]): Promise<string | null> {
  if (req.status !== 'pending') return 'This request is already closed.';
  if (req.requester_user_id === user.id) return 'You raised this request, so you can’t approve it. It goes to the next person in the chain.';
  if (steps.some((s) => s.decided_by === user.id || s.on_behalf_of === user.id)) return 'You already signed an earlier step. A different person must sign this one.';
  const actors = await actorsFor(tx, req, steps);
  if (!actors.some((a) => a.userId === user.id)) return 'This step is waiting on someone else.';
  return null;
}

/** May this person see the request at all? */
export async function canSee(tx: Tx, user: CurrentUser, req: RequestRow, steps: StepRow[]): Promise<boolean> {
  if (user.isOwner) return true;
  if (steps.some((s) => s.decided_by === user.id || s.on_behalf_of === user.id)) return true;
  if ((await actorsFor(tx, req, steps)).some((a) => a.userId === user.id)) return true;
  if ((user.role.levels.approvals ?? 0) < 1) return false;
  if ((user.role.levels[KIND_MODULE[req.kind]] ?? 0) < 1) return false;
  if (user.role.scope === 'company') return true;
  return req.department !== null && req.department === user.department;
}

async function notifyActors(tx: Tx, req: RequestRow, actors: Actor[], text: string, kind = 'waiting') {
  for (const a of actors) {
    await tx.query('INSERT INTO notifications (company_id, user_id, kind, text, request_id) VALUES ($1, $2, $3, $4, $5)', [req.company_id, a.userId, kind, text, req.id]);
  }
}

async function event(tx: Tx, req: { id: string; company_id: string }, what: string, actorId: string | null = null) {
  await tx.query('INSERT INTO request_events (company_id, request_id, actor_id, what) VALUES ($1, $2, $3, $4)', [req.company_id, req.id, actorId, what]);
}

async function writeSteps(tx: Tx, req: { id: string; company_id: string }, plan: { role: RoleKey; label: string }[]) {
  await tx.query('DELETE FROM request_steps WHERE request_id = $1', [req.id]);
  for (const [i, s] of plan.entries()) {
    await tx.query(
      'INSERT INTO request_steps (company_id, request_id, position, role_key, label, state) VALUES ($1, $2, $3, $4, $5, $6)',
      [req.company_id, req.id, i, s.role, s.label, i === 0 ? 'now' : 'later'],
    );
  }
}

export type UpsertResult = { status: 'created' | 'updated' | 'ignored_old_version' | 'not_routed'; requestId?: string };

/**
 * A partner sent a request, or a new version of one. A newer version always restarts the
 * Control Center's steps from the first one, so nobody's earlier approval carries over
 * to content they never saw.
 */
export async function upsertRequest(tx: Tx, companyId: string, msg: RequestMessage): Promise<UpsertResult> {
  const r = msg.request;
  if (KIND_SYSTEM[r.kind] !== msg.system) throw new AppError(400, 'wrong_system', `${SYSTEM_NAME[msg.system]} can’t send ${r.kind} requests.`);
  const rules = await loadRules(tx);
  const requester = r.requesterEmployeeId
    ? (await tx.query<{ id: string; key: RoleKey | null }>(
        'SELECT u.id, ro.key FROM users u JOIN people p ON p.id = u.person_id JOIN roles ro ON ro.id = u.role_id WHERE p.employee_id = $1',
        [r.requesterEmployeeId],
      )).rows[0]
    : undefined;
  const plan = consoleChain({ kind: r.kind, amountMinor: r.money?.amountMinor ?? null, requesterRoleKey: requester?.key ?? null }, rules);
  if (plan.length === 0) return { status: 'not_routed' };

  const existing = (await tx.query<RequestRow>('SELECT * FROM requests WHERE system = $1 AND external_id = $2 FOR UPDATE', [msg.system, r.externalId])).rows[0];
  if (existing && r.version <= existing.version) return { status: 'ignored_old_version', requestId: existing.id };

  const values = [
    r.version, r.title, r.subtitle, r.requesterEmployeeId, requester?.id ?? null, r.department, r.money?.amountMinor ?? null, r.money?.currency ?? null,
    JSON.stringify(r.facts), JSON.stringify(r.masked), JSON.stringify(r.partnerSteps), r.bulkEligible, msg.traceId,
  ];
  let req: RequestRow;
  if (existing) {
    req = (await tx.query<RequestRow>(
      `UPDATE requests SET version = $1, title = $2, subtitle = $3, requester_employee_id = $4, requester_user_id = $5, department = $6,
              amount_minor = $7, currency = $8, facts = $9, masked = $10, partner_steps = $11, bulk_eligible = $12, trace_id = $13,
              status = 'pending', current_step = 0, step_started_at = now(), reminded_at = NULL, escalated_at = NULL,
              changed_upstream = $14, locked = false, updated_at = now()
        WHERE id = $15 RETURNING *`,
      [...values, existing.status === 'pending', existing.id],
    )).rows[0]!;
    await writeSteps(tx, req, plan);
    await event(tx, req, `Version ${r.version} arrived from the ${SYSTEM_NAME[msg.system]}. The Control Center steps start again from the first one.`);
    await audit(tx, { companyId, action: 'request.new_version', category: 'sync', targetType: 'request', targetId: req.ref, traceId: msg.traceId, detail: { from: existing.version, to: r.version, previousStatus: existing.status } });
  } else {
    req = (await tx.query<RequestRow>(
      `INSERT INTO requests (company_id, system, external_id, kind, version, title, subtitle, requester_employee_id, requester_user_id, department,
                             amount_minor, currency, facts, masked, partner_steps, bulk_eligible, trace_id)
       VALUES ($14, $15, $16, $17, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
      [...values, companyId, msg.system, r.externalId, r.kind],
    )).rows[0]!;
    await writeSteps(tx, req, plan);
    await event(tx, req, `Arrived from the ${SYSTEM_NAME[msg.system]} after its own steps.`);
    await audit(tx, { companyId, action: 'request.received', category: 'sync', targetType: 'request', targetId: req.ref, traceId: msg.traceId, detail: { kind: r.kind } });
  }
  await notifyActors(tx, req, await actorsFor(tx, req, await loadSteps(tx, req.id)), `${req.title} is waiting for your decision.`);
  return { status: existing ? 'updated' : 'created', requestId: req.id };
}

export async function cancelRequest(tx: Tx, companyId: string, msg: CancelMessage): Promise<'cancelled' | 'ignored'> {
  const req = (await tx.query<RequestRow>('SELECT * FROM requests WHERE system = $1 AND external_id = $2 FOR UPDATE', [msg.system, msg.externalId])).rows[0];
  if (!req || msg.version < req.version || ['approved', 'rejected', 'cancelled'].includes(req.status)) return 'ignored';
  await tx.query(`UPDATE requests SET status = 'cancelled', updated_at = now() WHERE id = $1`, [req.id]);
  await event(tx, req, `Withdrawn in the ${SYSTEM_NAME[msg.system]}${msg.reason ? `: ${msg.reason}` : '.'}`);
  await audit(tx, { companyId, action: 'request.cancelled_upstream', category: 'sync', targetType: 'request', targetId: req.ref, traceId: msg.traceId });
  return 'cancelled';
}

export interface DecideInput {
  decision: Decision;
  version: number;
  note?: string | undefined;
  reauthOk: boolean;
  ip?: string;
}

/**
 * Applies one decision. Runs inside a transaction with the request row locked, so two
 * people clicking at once can't both sign the same step.
 */
export async function decide(tx: Tx, user: CurrentUser, requestId: string, input: DecideInput): Promise<RequestRow> {
  const req = (await tx.query<RequestRow>('SELECT * FROM requests WHERE id = $1 FOR UPDATE', [requestId])).rows[0];
  if (!req) throw new AppError(404, 'not_found', 'Request not found.');
  const steps = await loadSteps(tx, req.id);
  if (!(await canSee(tx, user, req, steps))) throw new AppError(404, 'not_found', 'Request not found.');
  if (req.status !== 'pending') throw new AppError(409, 'already_decided', 'This request was already decided.');
  if (input.version !== req.version) {
    throw new AppError(409, 'stale_version', `This request changed in the ${SYSTEM_NAME[req.system]} (now version ${req.version}). Review the new version, then decide again.`);
  }
  if (req.requester_user_id === user.id) throw new AppError(403, 'self_approval', 'You can’t decide a request you raised.');
  if (steps.some((s) => s.decided_by === user.id || s.on_behalf_of === user.id)) {
    throw new AppError(403, 'same_signer', 'You already signed an earlier step. A different person must sign this one.');
  }
  const me = (await actorsFor(tx, req, steps)).find((a) => a.userId === user.id);
  if (!me) throw new AppError(403, 'not_your_step', 'This step is waiting on someone else.');
  const rules = await loadRules(tx);
  if (input.decision === 'approve' && rules.reauthFor.includes(req.kind) && !input.reauthOk) {
    throw new AppError(401, 'reauth_required', 'Enter your password again to approve this.');
  }
  const note = input.note?.trim() || null;
  if (input.decision === 'send_back' && !note) throw new AppError(400, 'note_required', 'Say what needs to change before sending it back.');

  const step = steps.find((s) => s.position === req.current_step)!;
  const stepState = input.decision === 'approve' ? 'done' : input.decision === 'reject' ? 'rejected' : 'returned';
  await tx.query('UPDATE request_steps SET state = $2, decided_by = $3, on_behalf_of = $4, decided_at = now(), note = $5 WHERE id = $1', [
    step.id, stepState, user.id, me.onBehalfOf, note,
  ]);

  const last = req.current_step === steps.length - 1;
  let status: RequestStatus = 'pending';
  if (input.decision === 'reject') status = 'rejected';
  else if (input.decision === 'send_back') status = 'returned';
  else if (last) status = 'approved';

  if (status === 'pending') {
    await tx.query(`UPDATE request_steps SET state = 'now' WHERE request_id = $1 AND position = $2`, [req.id, req.current_step + 1]);
    await tx.query(
      `UPDATE requests SET current_step = current_step + 1, step_started_at = now(), reminded_at = NULL, escalated_at = NULL, changed_upstream = false, updated_at = now() WHERE id = $1`,
      [req.id],
    );
  } else {
    // Payroll locks once approved: any later change arrives as a new version needing both signatures again.
    await tx.query('UPDATE requests SET status = $2, locked = $3, changed_upstream = false, updated_at = now() WHERE id = $1', [req.id, status, status === 'approved' && req.kind === 'payroll']);
  }

  const words = { approve: 'Approved', reject: 'Rejected', send_back: 'Sent back for changes' }[input.decision];
  await event(tx, req, `${words} at “${step.label}”${note ? `: ${note}` : '.'}`, user.id);
  await audit(tx, {
    companyId: req.company_id, actorUserId: user.id, onBehalfOf: me.onBehalfOf, action: `request.${input.decision}`, category: 'approvals',
    targetType: 'request', targetId: req.ref, traceId: req.trace_id, ip: input.ip, detail: { step: step.label, version: req.version, final: status !== 'pending' },
  });

  // The step has moved on: earlier "waiting on you" alerts for it are no longer actionable.
  await tx.query(`UPDATE notifications SET read_at = now() WHERE request_id = $1 AND kind IN ('waiting', 'reminder', 'escalation') AND read_at IS NULL`, [req.id]);
  const updated = (await tx.query<RequestRow>('SELECT * FROM requests WHERE id = $1', [req.id])).rows[0]!;
  if (status === 'pending') {
    await notifyActors(tx, updated, await actorsFor(tx, updated, await loadSteps(tx, req.id)), `${req.title} is waiting for your decision.`);
  } else {
    await enqueueDecision(tx, updated, status, note, user, me.onBehalfOf);
  }
  return updated;
}

/** Writes the final decision to the outbox in the same transaction; the worker delivers it. */
async function enqueueDecision(tx: Tx, req: RequestRow, status: 'approved' | 'rejected' | 'returned', note: string | null, user: CurrentUser, onBehalfOf: string | null) {
  const behalf = onBehalfOf
    ? (await tx.query<{ name: string; role: string }>('SELECT p.full_name AS name, r.name AS role FROM users u JOIN people p ON p.id = u.person_id JOIN roles r ON r.id = u.role_id WHERE u.id = $1', [onBehalfOf])).rows[0] ?? null
    : null;
  const messageId = randomUUID();
  const payload: DecisionMessage = {
    messageId,
    contractVersion: CONTRACT_VERSION,
    sentAt: new Date().toISOString(),
    traceId: req.trace_id,
    type: 'request.decision',
    externalId: req.external_id,
    version: req.version,
    decision: status,
    note,
    decidedBy: { name: user.fullName, role: user.role.name },
    onBehalfOf: behalf,
  };
  await tx.query('INSERT INTO outbox (company_id, system, message_id, trace_id, payload) VALUES ($1, $2, $3, $4, $5)', [
    req.company_id, req.system, messageId, req.trace_id, JSON.stringify(payload),
  ]);
}
