import { BULK_KINDS, type ChainStepView, type RequestDetail, type RequestSummary } from '@ceo/shared';
import type { Tx } from './db.js';
import type { CurrentUser } from './guard.js';
import { actorsFor, blockedReason, loadRules, loadSteps, type RequestRow, type StepRow } from './approvals.js';

async function names(tx: Tx, ids: (string | null)[]): Promise<Map<string, string>> {
  const list = [...new Set(ids.filter(Boolean) as string[])];
  if (list.length === 0) return new Map();
  const rows = (await tx.query<{ id: string; full_name: string }>('SELECT u.id, p.full_name FROM users u JOIN people p ON p.id = u.person_id WHERE u.id = ANY($1)', [list])).rows;
  return new Map(rows.map((r) => [r.id, r.full_name]));
}

export async function summarize(tx: Tx, user: CurrentUser, req: RequestRow, steps: StepRow[], remindAfterHours: number): Promise<RequestSummary> {
  const actors = await actorsFor(tx, req, steps);
  const mine = actors.find((a) => a.userId === user.id);
  const behalf = mine?.onBehalfOf ? (await names(tx, [mine.onBehalfOf])).get(mine.onBehalfOf) ?? null : null;
  const ageHours = Math.max(0, Math.floor((Date.now() - req.step_started_at.getTime()) / 3600_000));
  return {
    id: req.id,
    ref: req.ref,
    system: req.system,
    kind: req.kind,
    title: req.title,
    subtitle: req.subtitle,
    money: req.amount_minor !== null && req.currency ? { amountMinor: Number(req.amount_minor), currency: req.currency.trim() } : null,
    status: req.status,
    version: req.version,
    ageHours,
    overdue: req.status === 'pending' && ageHours >= remindAfterHours,
    changedUpstream: req.status === 'pending' && req.changed_upstream,
    yourTurn: Boolean(mine),
    onBehalfOf: behalf,
    bulkEligible: req.status === 'pending' && req.bulk_eligible && BULK_KINDS.includes(req.kind) && Boolean(mine),
  };
}

export async function detail(tx: Tx, user: CurrentUser, req: RequestRow): Promise<RequestDetail> {
  const steps = await loadSteps(tx, req.id);
  const rules = await loadRules(tx);
  const summary = await summarize(tx, user, req, steps, rules.remindAfterHours);
  const who = await names(tx, steps.flatMap((s) => [s.decided_by, s.on_behalf_of]));
  const events = (await tx.query<{ at: Date; actor_id: string | null; what: string }>('SELECT at, actor_id, what FROM request_events WHERE request_id = $1 ORDER BY at, id', [req.id])).rows;
  const eventNames = await names(tx, events.map((e) => e.actor_id));
  const chain: ChainStepView[] = [
    ...req.partner_steps.map((p) => ({ label: `${p.label} · ${p.by}`, owner: 'partner' as const, state: 'done' as const, decidedBy: p.by, onBehalfOf: null, decidedAt: p.at, note: null })),
    ...steps.map((s) => ({
      label: s.label,
      owner: 'console' as const,
      state: s.state,
      decidedBy: s.decided_by ? who.get(s.decided_by) ?? null : null,
      onBehalfOf: s.on_behalf_of ? who.get(s.on_behalf_of) ?? null : null,
      decidedAt: s.decided_at?.toISOString() ?? null,
      note: s.note,
    })),
  ];
  return {
    ...summary,
    traceId: req.trace_id,
    facts: req.facts,
    hasMaskedSalary: req.masked.some((m) => m.field === 'salary'),
    chain,
    blockedReason: req.status === 'pending' ? await blockedReason(tx, user, req, steps) : null,
    needsReauth: rules.reauthFor.includes(req.kind),
    events: events.map((e) => ({ at: e.at.toISOString(), who: e.actor_id ? eventNames.get(e.actor_id) ?? 'Someone' : 'System', what: e.what })),
  };
}
