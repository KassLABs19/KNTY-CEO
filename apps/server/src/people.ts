import type { PeopleMessage } from '@ceo/shared';
import type { Tx } from './db.js';
import { audit } from './audit.js';

async function notifyOwners(tx: Tx, companyId: string, kind: string, text: string) {
  await tx.query(
    `INSERT INTO notifications (company_id, user_id, kind, text) SELECT $1, id, $2, $3 FROM users WHERE is_owner AND status = 'active'`,
    [companyId, kind, text],
  );
}

/**
 * Someone left the company. Their login is suspended, every session is signed out,
 * delegations to and from them end, and unused invites stop working. Their pending
 * steps move on by themselves: suspended people are never approvers.
 */
export async function applyLeaver(tx: Tx, companyId: string, personId: string, traceId: string | null): Promise<boolean> {
  const user = (await tx.query<{ id: string; status: string }>('SELECT id, status FROM users WHERE person_id = $1', [personId])).rows[0];
  if (!user || user.status === 'suspended') return false;
  await tx.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [user.id]);
  await tx.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [user.id]);
  await tx.query('UPDATE delegations SET ended_at = now() WHERE (from_user_id = $1 OR to_user_id = $1) AND ended_at IS NULL', [user.id]);
  await tx.query('UPDATE invites SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [user.id]);
  const name = (await tx.query<{ full_name: string }>('SELECT full_name FROM people WHERE id = $1', [personId])).rows[0]?.full_name ?? 'Someone';
  await audit(tx, { companyId, action: 'logins.suspended_leaver', category: 'sync', targetType: 'user', targetId: user.id, traceId, detail: { person: name } });
  await notifyOwners(tx, companyId, 'people', `${name} left the company. Their login was suspended and they were signed out everywhere.`);
  return true;
}

/** Applies a joiner, mover, leaver or details message from the HR system. */
export async function applyPeopleEvent(tx: Tx, companyId: string, msg: PeopleMessage): Promise<string> {
  const e = msg.employee;
  const existing = (await tx.query<{ id: string; department: string | null; job_title: string | null }>(
    'SELECT id, department, job_title FROM people WHERE employee_id = $1',
    [e.employeeId],
  )).rows[0];

  let personId: string;
  if (!existing) {
    personId = (await tx.query<{ id: string }>(
      `INSERT INTO people (company_id, employee_id, full_name, email, department, job_title) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [companyId, e.employeeId, e.fullName, e.email, e.department, e.jobTitle],
    )).rows[0]!.id;
  } else {
    personId = existing.id;
    await tx.query(
      `UPDATE people SET full_name = $2, email = $3, department = $4, job_title = $5,
              needs_role_review = needs_role_review OR $6, updated_at = now() WHERE id = $1`,
      [personId, e.fullName, e.email, e.department, e.jobTitle, msg.event === 'mover' && e.titleChanged],
    );
    // Sign-in uses the email the HR system holds.
    await tx.query('UPDATE users SET email = $2 WHERE person_id = $1', [personId, e.email]);
  }

  const hasLogin = (await tx.query('SELECT 1 FROM users WHERE person_id = $1', [personId])).rowCount === 1;
  if (msg.event === 'joiner') {
    await notifyOwners(tx, companyId, 'people', `${e.fullName} joined${e.department ? ` ${e.department}` : ''}. Invite them if they need the Control Center.`);
  }
  if (msg.event === 'mover' && hasLogin) {
    const what = e.titleChanged ? 'Check that their role still fits.' : 'What they can see now follows the new department.';
    await notifyOwners(tx, companyId, 'people', `${e.fullName} moved${e.department ? ` to ${e.department}` : ''}. ${what}`);
  }
  if (msg.event === 'leaver') {
    await tx.query('UPDATE people SET left_on = $2 WHERE id = $1', [personId, e.effectiveDate]);
    const today = new Date().toISOString().slice(0, 10);
    if (e.effectiveDate <= today) await applyLeaver(tx, companyId, personId, msg.traceId);
  }
  await audit(tx, { companyId, action: `people.${msg.event}`, category: 'sync', targetType: 'person', targetId: e.employeeId, traceId: msg.traceId, detail: { name: e.fullName } });
  return personId;
}
