import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { CONTRACT_VERSION, SIGNATURE_HEADER, type RequestSummary } from '@ceo/shared';
import { loadConfig, type Config } from '../src/config.js';
import { createPool, withCompany, withSystem, type Db } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { buildApp } from '../src/app.js';
import { seed, DEMO_PASSWORD, DEMO_PARTNER_SECRETS } from '../src/seed.js';
import { currentTotp } from '../src/auth/totp.js';
import { signBody, verifySignature } from '../src/integration/hmac.js';
import { deliverDue, backoffMinutes } from '../src/integration/outbox.js';
import { sweepCompany } from '../src/jobs.js';
import type { LicenceState } from '../src/licence.js';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

let db: Db;
let app: FastifyInstance;
let config: Config;
let companyId: string;
const licence: LicenceState = { status: 'not_required' };
const sys = (sql: string, params: unknown[] = []) => withSystem(db, (tx) => tx.query(sql, params));

beforeAll(async () => {
  config = loadConfig({ DATABASE_URL: inject('databaseUrl'), JWT_SECRET: 'x'.repeat(40), LOCK_AFTER_FAILED_ATTEMPTS: '3', LOGIN_RATE_LIMIT: '1000', RUN_JOBS: 'off' });
  db = createPool(config.DATABASE_URL);
  await migrate(db, () => {});
  companyId = await seed(db, () => {});
  app = await buildApp(db, config, () => licence, { logger: false });
});

afterAll(async () => {
  await app?.close();
  await db?.end();
});

const login = (email: string, password = DEMO_PASSWORD, appVersion = '0.1.0') =>
  app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password, appVersion } });

/** Signs someone all the way in (doing the two-step part when their role needs it). */
async function signIn(email: string): Promise<string> {
  const first = (await login(email)).json();
  if (first.step === 'done') return first.session.accessToken;
  const secret = first.secret ?? (await sys('SELECT totp_secret FROM users WHERE email = $1', [email])).rows[0].totp_secret;
  const res = await app.inject({ method: 'POST', url: '/api/auth/2fa', payload: { challengeToken: first.challengeToken, code: currentTotp(secret) } });
  expect(res.statusCode).toBe(200);
  return res.json().accessToken;
}

const h = (token: string, extra: Record<string, string> = {}) => ({ authorization: `Bearer ${token}`, ...extra });
const get = (token: string, url: string) => app.inject({ method: 'GET', url, headers: h(token) });
const post = (token: string, url: string, payload: unknown, extra: Record<string, string> = {}) => app.inject({ method: 'POST', url, payload: payload as object, headers: h(token, extra) });
async function reauth(token: string) {
  const res = await post(token, '/api/auth/reauth', { password: DEMO_PASSWORD });
  expect(res.statusCode).toBe(200);
  return res.json().reauthToken as string;
}
const byExternal = async (externalId: string) => (await sys('SELECT id, version, status, locked FROM requests WHERE external_id = $1', [externalId])).rows[0];

/** Sends a signed message as a partner, the way the HR system or Predicto would. */
async function partnerSend(system: 'hr' | 'predicto', body: Record<string, unknown>, opts: { secret?: string; messageId?: string } = {}) {
  const partnerId = (await sys('SELECT id FROM partners WHERE company_id = $1 AND system = $2', [companyId, system])).rows[0].id;
  const raw = JSON.stringify({ messageId: opts.messageId ?? randomUUID(), system, contractVersion: CONTRACT_VERSION, sentAt: new Date().toISOString(), traceId: 'trace-1', ...body });
  return app.inject({
    method: 'POST', url: '/api/integration/inbound', payload: raw,
    headers: { 'content-type': 'application/json', 'x-cc-partner': partnerId, [SIGNATURE_HEADER]: signBody(raw, opts.secret ?? DEMO_PARTNER_SECRETS[system].inbound) },
  });
}
const requestBody = (externalId: string, kind: string, extra: Record<string, unknown> = {}) => ({
  type: 'request.upsert',
  request: { externalId, version: 1, kind, title: `${kind} ${externalId}`, ...extra },
});

describe('health and version', () => {
  it('reports health and the contract version', async () => {
    expect((await app.inject('/health')).json()).toMatchObject({ status: 'ok' });
    expect((await app.inject('/api/version')).json().contractVersion).toBe(CONTRACT_VERSION);
  });
  it('tells an old desktop app to update', async () => {
    expect((await login('ruth@demo.local', DEMO_PASSWORD, '0.0.9')).statusCode).toBe(426);
  });
});

describe('sign-in', () => {
  it('signs a department head in without two-step', async () => {
    expect((await login('ruth@demo.local')).json().step).toBe('done');
  });

  it('makes the CEO (an owner) set up two-step sign-in', async () => {
    expect((await login('hana@demo.local')).json().step).toBe('2fa-setup');
  });

  it('refuses people with no login, without saying whether the email exists', async () => {
    const a = await login('samuel@demo.local');
    const b = await login('nobody@demo.local');
    expect(a.statusCode).toBe(401);
    expect(a.json().message).toBe(b.json().message);
  });

  it('locks an account after repeated wrong passwords and tells the owners', async () => {
    for (let i = 0; i < 2; i++) expect((await login('yonas@demo.local', 'wrong-pass-1')).statusCode).toBe(401);
    expect((await login('yonas@demo.local', 'wrong-pass-1')).statusCode).toBe(423);
    expect((await login('yonas@demo.local')).statusCode).toBe(423);
    const note = await sys(`SELECT text FROM notifications n JOIN users u ON u.id = n.user_id WHERE u.email = 'hana@demo.local' AND n.kind = 'security'`);
    expect(note.rows.some((r) => String(r.text).includes('yonas@demo.local'))).toBe(true);
    await sys(`UPDATE users SET locked_at = NULL, failed_attempts = 0 WHERE email = 'yonas@demo.local'`);
  });

  it('keeps owners-only screens from everyone else', async () => {
    const ruth = await signIn('ruth@demo.local');
    expect((await get(ruth, '/api/people')).statusCode).toBe(403);
  });
});

describe('data stays inside each company', () => {
  it('hides other companies’ rows even without a filter', async () => {
    const other = (await sys(`INSERT INTO companies (name) VALUES ('Other Co') RETURNING id`)).rows[0].id;
    const seen = await withCompany(db, other, async (tx) => (await tx.query('SELECT count(*)::int AS n FROM requests')).rows[0].n);
    expect(seen).toBe(0);
  });

  it('refuses edits and deletes in the audit log', async () => {
    await expect(sys('UPDATE audit_log SET action = $1', ['x'])).rejects.toThrow(/cannot be changed/);
    await expect(sys('DELETE FROM audit_log')).rejects.toThrow(/cannot be changed/);
  });
});

describe('approvals', () => {
  let hana: string;
  let mekdes: string;
  beforeAll(async () => {
    hana = await signIn('hana@demo.local');
    mekdes = await signIn('mekdes@demo.local');
  });

  it('shows the CEO what waits on them, including what they handle as a delegate', async () => {
    const mine = (await get(hana, '/api/requests?filter=mine')).json() as RequestSummary[];
    const titles = mine.map((r) => r.title);
    expect(titles).toContain('Payroll run · October');
    expect(titles).toContain('Expense claim · conference travel');
    expect(titles).not.toContain('Refund request'); // limits not set: refunds go to the CFO
    const payment = mine.find((r) => r.kind === 'manual_payment')!;
    expect(payment.onBehalfOf).toBe('Liya Haile');
    expect(payment.bulkEligible).toBe(true);
  });

  it('needs the password again to sign payroll, then locks it and queues the decision', async () => {
    const pay = await byExternal('PAY-2026-10');
    const without = await post(hana, `/api/requests/${pay.id}/decide`, { decision: 'approve', version: pay.version });
    expect(without.json().error).toBe('reauth_required');
    const ok = await post(hana, `/api/requests/${pay.id}/decide`, { decision: 'approve', version: pay.version }, { 'x-reauth-token': await reauth(hana) });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().status).toBe('approved');
    expect((await byExternal('PAY-2026-10')).locked).toBe(true);
    const out = (await sys(`SELECT payload FROM outbox WHERE system = 'hr' AND payload->>'externalId' = 'PAY-2026-10'`)).rows[0].payload;
    expect(out).toMatchObject({ type: 'request.decision', decision: 'approved', version: 1 });
  });

  it('never lets one person sign both payroll steps', async () => {
    expect((await partnerSend('hr', requestBody('PAY-2026-11', 'payroll', { money: { amountMinor: 1000, currency: 'ETB' } }))).json().status).toBe('created');
    const pay = await byExternal('PAY-2026-11');
    const rt = await reauth(mekdes);
    expect((await post(mekdes, `/api/requests/${pay.id}/decide`, { decision: 'approve', version: 1 }, { 'x-reauth-token': rt })).statusCode).toBe(200);
    const again = await post(mekdes, `/api/requests/${pay.id}/decide`, { decision: 'approve', version: 1 }, { 'x-reauth-token': rt });
    expect(again.json().error).toBe('same_signer');
  });

  it('never hands payroll to a delegate', async () => {
    const yonasId = (await sys(`SELECT id FROM users WHERE email = 'yonas@demo.local'`)).rows[0].id;
    expect((await post(mekdes, '/api/delegations', { toUserId: yonasId, endsAt: new Date(Date.now() + 86400_000).toISOString() })).statusCode).toBe(200);
    expect((await partnerSend('hr', requestBody('PAY-2026-12', 'payroll'))).statusCode).toBe(200);
    const yonas = await signIn('yonas@demo.local');
    const pay = await byExternal('PAY-2026-12');
    const res = await post(yonas, `/api/requests/${pay.id}/decide`, { decision: 'approve', version: 1 }, { 'x-reauth-token': await reauth(yonas) });
    expect(res.statusCode).toBe(403);
  });

  it('stops people approving their own request', async () => {
    const exp = await byExternal('EXP-0912');
    const res = await post(mekdes, `/api/requests/${exp.id}/decide`, { decision: 'approve', version: 1 });
    expect(res.json().error).toBe('self_approval');
  });

  it('refuses a decision on an old version and shows the change', async () => {
    const leave = await byExternal('LV-3381');
    const v2 = requestBody('LV-3381', 'leave', { version: 2, title: 'Leave request · 5 days', requesterEmployeeId: 'E-005', department: 'Sales' });
    expect((await partnerSend('hr', v2)).json().status).toBe('updated');
    const stale = await post(hana, `/api/requests/${leave.id}/decide`, { decision: 'approve', version: 1 });
    expect(stale.json().error).toBe('stale_version');
    const view = (await get(hana, `/api/requests/${leave.id}`)).json();
    expect(view.changedUpstream).toBe(true);
    expect((await post(hana, `/api/requests/${leave.id}/decide`, { decision: 'approve', version: 2 })).json().status).toBe('approved');
  });

  it('sends a request back with a note, and restarts it when resubmitted', async () => {
    const hire = await byExternal('HIRE-0044');
    expect((await post(mekdes, `/api/requests/${hire.id}/decide`, { decision: 'send_back', version: 1 })).json().error).toBe('note_required');
    const back = await post(mekdes, `/api/requests/${hire.id}/decide`, { decision: 'send_back', version: 1, note: 'Attach the budget line.' });
    expect(back.json().status).toBe('returned');
    expect((await partnerSend('hr', requestBody('HIRE-0044', 'hire', { version: 2 }))).json().status).toBe('updated');
    const again = (await get(mekdes, `/api/requests/${hire.id}`)).json();
    expect(again.status).toBe('pending');
    expect(again.yourTurn).toBe(true);
  });

  it('bulk-approves checked payments as a delegate and records on whose behalf', async () => {
    const mine = (await get(hana, '/api/requests?filter=mine')).json() as RequestSummary[];
    const items = mine.filter((r) => r.bulkEligible).map((r) => ({ id: r.id, version: r.version }));
    expect(items.length).toBe(3);
    const res = (await post(hana, '/api/requests/bulk-approve', { items })).json();
    expect(res.approved.length).toBe(3);
    const audit = await sys(`SELECT on_behalf_of FROM audit_log WHERE action = 'request.approve' AND target_id IN (SELECT ref FROM requests WHERE kind = 'manual_payment')`);
    expect(audit.rows.every((r) => r.on_behalf_of)).toBe(true);
  });
});

describe('partner messages', () => {
  it('refuses a bad signature', async () => {
    expect((await partnerSend('hr', requestBody('X-1', 'leave'), { secret: 'wrong-secret' })).statusCode).toBe(401);
  });

  it('applies a message once, however often it is retried', async () => {
    const messageId = randomUUID();
    const body = requestBody('RF-9001', 'refund', { money: { amountMinor: 500, currency: 'ETB' } });
    expect((await partnerSend('predicto', body, { messageId })).json().status).toBe('created');
    expect((await partnerSend('predicto', body, { messageId })).json().status).toBe('duplicate');
  });

  it('ignores an older version arriving late', async () => {
    expect((await partnerSend('hr', requestBody('LV-3381', 'leave', { version: 1, requesterEmployeeId: 'E-005' }))).json().status).toBe('ignored_old_version');
  });

  it('only lets the HR system send its own kinds of request', async () => {
    expect((await partnerSend('predicto', requestBody('P-1', 'payroll'))).statusCode).toBe(400);
  });

  it('suspends a leaver at once and signs them out', async () => {
    const ruth = await signIn('ruth@demo.local');
    const res = await partnerSend('hr', {
      type: 'people.event', event: 'leaver',
      employee: { employeeId: 'E-005', fullName: 'Ruth Kebede', email: 'ruth@demo.local', department: 'Sales', jobTitle: 'Head of Sales', effectiveDate: new Date().toISOString().slice(0, 10) },
    });
    expect(res.statusCode).toBe(200);
    expect((await get(ruth, '/api/me')).statusCode).toBe(401);
    expect((await login('ruth@demo.local')).statusCode).toBe(401);
  });

  it('only invites people the HR system knows, and the invite works once', async () => {
    const hana = await signIn('hana@demo.local');
    const joiner = await partnerSend('hr', {
      type: 'people.event', event: 'joiner',
      employee: { employeeId: 'E-050', fullName: 'Kidus Fikre', email: 'kidus@demo.local', department: 'Engineering', jobTitle: 'Engineering Lead', effectiveDate: '2026-11-01' },
    });
    expect(joiner.statusCode).toBe(200);
    const person = (await sys(`SELECT id FROM people WHERE employee_id = 'E-050'`)).rows[0].id;
    const role = (await sys(`SELECT id FROM roles WHERE key = 'dept_head' AND company_id = $1`, [companyId])).rows[0].id;
    const invite = (await post(hana, `/api/people/${person}/invite`, { roleId: role })).json();
    expect(invite.inviteLink).toMatch(/^kntyceo:\/\/invite\//);
    expect((await app.inject(`/api/invites/${invite.inviteToken}`)).json().fullName).toBe('Kidus Fikre');
    expect((await app.inject({ method: 'POST', url: '/api/invites/accept', payload: { token: invite.inviteToken, password: 'short' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/invites/accept', payload: { token: invite.inviteToken, password: 'a-good-password-1' } })).statusCode).toBe(204);
    expect((await app.inject({ method: 'POST', url: '/api/invites/accept', payload: { token: invite.inviteToken, password: 'a-good-password-1' } })).statusCode).toBe(404);
    expect((await login('kidus@demo.local', 'a-good-password-1')).json().step).toBe('done');
    const leftPerson = (await sys(`SELECT id FROM people WHERE employee_id = 'E-005'`)).rows[0].id;
    expect((await post(hana, `/api/people/${leftPerson}/invite`, { roleId: role })).json().error).toBe('person_left');
  });
});

describe('settings', () => {
  it('needs the password again, checks the rules, then routes refunds by amount', async () => {
    const hana = await signIn('hana@demo.local');
    const rules = { refundOpsLimitMinor: 50_000, refundCfoLimitMinor: 500_000, deptHeadLeaveToCeo: true, remindAfterHours: 24, escalateAfterHours: 48, reauthFor: ['payroll'] };
    const put = (body: unknown, rt?: string) => app.inject({ method: 'PUT', url: '/api/settings/rules', payload: body as object, headers: h(hana, rt ? { 'x-reauth-token': rt } : {}) });
    expect((await put(rules)).json().error).toBe('reauth_required');
    const rt = await reauth(hana);
    expect((await put({ ...rules, refundCfoLimitMinor: 100 }, rt)).statusCode).toBe(400);
    expect((await put(rules, rt)).statusCode).toBe(200);
    await partnerSend('predicto', requestBody('RF-9100', 'refund', { money: { amountMinor: 600_000, currency: 'ETB' } }));
    const steps = (await sys(`SELECT role_key FROM request_steps s JOIN requests r ON r.id = s.request_id WHERE r.external_id = 'RF-9100' ORDER BY position`)).rows;
    expect(steps.map((s) => s.role_key)).toEqual(['ops_head', 'cfo', 'ceo']);
  });
});

describe('background jobs', () => {
  it('delivers the outbox signed, and backs off when the partner is down', async () => {
    await sys(`UPDATE partners SET base_url = 'https://partner.test' WHERE company_id = $1`, [companyId]);
    const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
    const ok = await deliverDue(db, async (url, init) => {
      calls.push({ url, ...init });
      return { ok: true, status: 200 };
    }, 100);
    expect(ok.delivered).toBeGreaterThan(0);
    const first = calls[0]!;
    expect(first.url).toMatch(/\/cc\/inbound$/);
    const system = JSON.parse(first.body).externalId.startsWith('RF') || JSON.parse(first.body).externalId.startsWith('MP') ? 'predicto' : 'hr';
    expect(verifySignature(first.headers[SIGNATURE_HEADER], first.body, DEMO_PARTNER_SECRETS[system].outbound)).toBe('ok');

    // A new decision, then the partner is down.
    const mekdes = await signIn('mekdes@demo.local');
    const rf = await byExternal('RF-9001');
    await post(mekdes, `/api/requests/${rf.id}/decide`, { decision: 'reject', version: 1, note: 'Past the deadline.' });
    const down = await deliverDue(db, async () => ({ ok: false, status: 503 }));
    expect(down.failed).toBe(1);
    const row = (await sys(`SELECT attempts, last_error, next_try_at > now() + interval '50 seconds' AS later FROM outbox WHERE delivered_at IS NULL`)).rows[0];
    expect(row).toMatchObject({ attempts: 1, later: true });
    expect(backoffMinutes(4)).toBe(60);
  });

  it('reminds, then escalates, and never approves on its own', async () => {
    const later = new Date(Date.now() + 50 * 3600_000);
    const res = await sweepCompany(db, companyId, later);
    expect(res.reminded).toBeGreaterThan(0);
    expect(res.escalated).toBeGreaterThan(0);
    const approvedBySystem = await sys(`SELECT count(*)::int AS n FROM request_steps WHERE state = 'done' AND decided_by IS NULL`);
    expect(approvedBySystem.rows[0].n).toBe(0);
  });
});
