import type { Db } from './db.js';
import { withCompany, withSystem } from './db.js';
import { actorsFor, loadRules, loadSteps, type RequestRow } from './approvals.js';
import { applyLeaver } from './people.js';
import { alertStuck, deliverDue, type Fetch } from './integration/outbox.js';

/**
 * Reminders and escalation. Escalation only tells more people; it never hands a step
 * to someone it doesn't belong to, so the order of signers and the two-signer rule
 * for payroll can't be bypassed. Nothing is ever approved automatically.
 */
export async function sweepCompany(db: Db, companyId: string, now = new Date()): Promise<{ reminded: number; escalated: number; leavers: number }> {
  return withCompany(db, companyId, async (tx) => {
    const rules = await loadRules(tx);
    let reminded = 0;
    let escalated = 0;
    const due = (await tx.query<RequestRow & { reminded_at: Date | null; escalated_at: Date | null }>(
      `SELECT * FROM requests WHERE status = 'pending'
          AND ((reminded_at IS NULL AND step_started_at <= $1::timestamptz - make_interval(hours => $2))
            OR (escalated_at IS NULL AND step_started_at <= $1::timestamptz - make_interval(hours => $3)))
        FOR UPDATE`,
      [now, rules.remindAfterHours, rules.escalateAfterHours],
    )).rows;
    for (const req of due) {
      const steps = await loadSteps(tx, req.id);
      const actors = await actorsFor(tx, req, steps);
      const hours = Math.floor((now.getTime() - req.step_started_at.getTime()) / 3600_000);
      const notify = async (userIds: string[], text: string, kind: string) => {
        for (const id of new Set(userIds)) {
          await tx.query('INSERT INTO notifications (company_id, user_id, kind, text, request_id) VALUES ($1, $2, $3, $4, $5)', [companyId, id, kind, text, req.id]);
        }
      };
      if (!req.reminded_at && hours >= rules.remindAfterHours) {
        await notify(actors.map((a) => a.userId), `Reminder: ${req.title} has waited ${hours} hours for your decision.`, 'reminder');
        await tx.query('UPDATE requests SET reminded_at = $2 WHERE id = $1', [req.id, now]);
        reminded++;
      }
      if (!req.escalated_at && hours >= rules.escalateAfterHours) {
        // Payroll goes to the owners; everything else to the next approver in the chain.
        const next = steps.find((s) => s.position === req.current_step + 1);
        const targets = req.kind === 'payroll' || !next
          ? (await tx.query<{ id: string }>(`SELECT id FROM users WHERE is_owner AND status = 'active'`)).rows.map((r) => r.id)
          : (await tx.query<{ id: string }>(`SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id WHERE r.key = $1 AND u.status = 'active'`, [next.role_key])).rows.map((r) => r.id);
        await notify([...targets, ...actors.map((a) => a.userId)], `Escalated: ${req.title} has waited ${hours} hours at “${steps.find((s) => s.position === req.current_step)?.label ?? 'its current step'}”.`, 'escalation');
        await tx.query('UPDATE requests SET escalated_at = $2 WHERE id = $1', [req.id, now]);
        await tx.query('INSERT INTO request_events (company_id, request_id, what) VALUES ($1, $2, $3)', [companyId, req.id, `Escalated after ${hours} hours.`]);
        escalated++;
      }
    }
    // Leavers whose exit date has now arrived.
    const leavers = (await tx.query<{ id: string }>(
      `SELECT p.id FROM people p JOIN users u ON u.person_id = p.id WHERE p.left_on <= $1::date AND u.status <> 'suspended'`,
      [now.toISOString().slice(0, 10)],
    )).rows;
    for (const p of leavers) await applyLeaver(tx, companyId, p.id, null);
    return { reminded, escalated, leavers: leavers.length };
  });
}

export async function sweepAll(db: Db, now = new Date()) {
  const companies = await withSystem(db, async (tx) => (await tx.query<{ id: string }>('SELECT id FROM companies')).rows);
  for (const c of companies) await sweepCompany(db, c.id, now);
}

/** Starts the background jobs: deliver the outbox every 30 seconds, sweep every 15 minutes. */
export function startJobs(db: Db, log: (o: object, m: string) => void, fetchFn: Fetch = fetch as unknown as Fetch): () => void {
  const safe = (name: string, fn: () => Promise<unknown>) => () => fn().catch((err: Error) => log({ err: err.message }, `${name} failed`));
  const outbox = setInterval(safe('outbox', async () => {
    await deliverDue(db, fetchFn);
    await alertStuck(db);
  }), 30_000);
  const sweep = setInterval(safe('sweep', () => sweepAll(db)), 15 * 60_000);
  outbox.unref();
  sweep.unref();
  return () => {
    clearInterval(outbox);
    clearInterval(sweep);
  };
}
