/**
 * Demo data for trying KNTY CEO locally. Safe to run more than once: it does nothing if
 * the demo company already exists. Never run this on a customer server.
 *
 *   npm run db:seed
 *
 * Every demo account uses DEMO_PASSWORD. Requests are loaded through the same code an
 * HR system message uses, so the demo follows the real request types.
 */
import { randomUUID } from 'node:crypto';
import { CONTRACT_VERSION, DEFAULT_RULES, SYSTEM_ROLES, type RequestMessage, type RoleKey } from '@ceo/shared';
import type { Db, Tx } from './db.js';
import { withCompany, withSystem } from './db.js';
import { hashPassword } from './auth/password.js';
import { decide, upsertRequest } from './approvals.js';
import { saveType, seedDefaultTypes } from './request-types.js';
import type { CurrentUser } from './guard.js';

export const DEMO_COMPANY = 'Demo Company';
export const DEMO_PASSWORD = 'demo-password-2026';
/** Fixed only so the demo HR simulator can sign messages. A real company gets random secrets. */
export const DEMO_HR_SECRETS = { inbound: 'demo-hr-to-ceo-secret-change-me-000000', outbound: 'demo-ceo-to-hr-secret-change-me-000000' } as const;

export const DEMO_PEOPLE: { employeeId: string; email: string; name: string; dept: string; title: string; role?: RoleKey; owner?: boolean }[] = [
  { employeeId: 'E-001', email: 'hana@demo.local', name: 'Hana Tesfaye', dept: 'Executive', title: 'Chief Executive Officer', role: 'ceo', owner: true },
  { employeeId: 'E-002', email: 'mekdes@demo.local', name: 'Mekdes Bekele', dept: 'Finance', title: 'Chief Financial Officer', role: 'cfo' },
  { employeeId: 'E-003', email: 'yonas@demo.local', name: 'Yonas Tadesse', dept: 'People', title: 'Head of HR', role: 'hr_head' },
  { employeeId: 'E-004', email: 'liya@demo.local', name: 'Liya Haile', dept: 'Operations', title: 'Head of Operations', role: 'ops_head' },
  { employeeId: 'E-005', email: 'ruth@demo.local', name: 'Ruth Kebede', dept: 'Sales', title: 'Head of Sales', role: 'dept_head' },
  { employeeId: 'E-006', email: 'samuel@demo.local', name: 'Samuel Desta', dept: 'Engineering', title: 'Engineering Lead' },
  { employeeId: 'E-007', email: 'meron@demo.local', name: 'Meron Alemu', dept: 'Finance', title: 'Finance Manager' },
];

const msg = (request: Partial<RequestMessage['request']> & Pick<RequestMessage['request'], 'externalId' | 'kind' | 'title'>): RequestMessage => ({
  messageId: randomUUID(),
  system: 'hr',
  contractVersion: CONTRACT_VERSION,
  sentAt: new Date().toISOString(),
  traceId: randomUUID().slice(0, 8),
  type: 'request.upsert',
  request: {
    version: 1,
    subtitle: '',
    requesterEmployeeId: null,
    department: null,
    money: null,
    facts: [],
    masked: [],
    bulkEligible: false,
    partnerSteps: [],
    ...request,
  },
});

async function asUser(tx: Tx, email: string): Promise<CurrentUser> {
  const r = (await tx.query(
    `SELECT u.id, u.company_id, u.is_owner, p.id AS person_id, p.full_name, p.department, ro.id AS rid, ro.key, ro.name, ro.scope, ro.levels
       FROM users u JOIN people p ON p.id = u.person_id JOIN roles ro ON ro.id = u.role_id WHERE u.email = $1`,
    [email],
  )).rows[0];
  return {
    id: r.id, companyId: r.company_id, sessionId: randomUUID(), personId: r.person_id, fullName: r.full_name, department: r.department, isOwner: r.is_owner,
    role: { id: r.rid, key: r.key, name: r.name, scope: r.scope, levels: r.levels },
  };
}

export async function seed(db: Db, log: (m: string) => void = console.log): Promise<string> {
  const companyId = await withSystem(db, async (tx) => {
    const existing = (await tx.query<{ id: string }>('SELECT id FROM companies WHERE name = $1', [DEMO_COMPANY])).rows[0];
    if (existing) return null;
    const id = (await tx.query<{ id: string }>('INSERT INTO companies (name) VALUES ($1) RETURNING id', [DEMO_COMPANY])).rows[0]!.id;

    const roleIds = new Map<RoleKey, string>();
    for (const r of SYSTEM_ROLES) {
      roleIds.set(r.key, (await tx.query<{ id: string }>(
        'INSERT INTO roles (company_id, key, name, scope, requires_2fa, levels, is_system) VALUES ($1, $2, $3, $4, $5, $6, true) RETURNING id',
        [id, r.key, r.name, r.scope, r.requires2fa, JSON.stringify(r.levels)],
      )).rows[0]!.id);
    }
    await tx.query('INSERT INTO settings (company_id, rules) VALUES ($1, $2)', [id, JSON.stringify(DEFAULT_RULES)]);
    await tx.query(
      `INSERT INTO partners (company_id, system, name, base_url, inbound_secret, outbound_secret) VALUES ($1, 'hr', 'HR system', NULL, $2, $3)`,
      [id, DEMO_HR_SECRETS.inbound, DEMO_HR_SECRETS.outbound],
    );
    await seedDefaultTypes(tx, id);
    // A request type an owner added in Settings, to show thresholds and bulk approval:
    // the Head of Operations decides every petty-cash payout; the CFO also signs above ETB 5,000.
    await saveType(tx, id, {
      key: 'petty_cash', name: 'Petty cash payout', module: 'finance', active: true,
      steps: [
        { roleId: roleIds.get('ops_head')!, label: 'Head of Operations', aboveMinor: null },
        { roleId: roleIds.get('cfo')!, label: 'CFO · above ETB 5,000', aboveMinor: 500_000 },
      ],
      reauth: false, delegable: true, bulkAllowed: true, lockWhenApproved: false,
    }, null);
    const hash = await hashPassword(DEMO_PASSWORD);
    for (const p of DEMO_PEOPLE) {
      const personId = (await tx.query<{ id: string }>(
        'INSERT INTO people (company_id, employee_id, full_name, email, department, job_title) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
        [id, p.employeeId, p.name, p.email, p.dept, p.title],
      )).rows[0]!.id;
      if (p.role) {
        await tx.query(
          `INSERT INTO users (company_id, person_id, email, role_id, is_owner, status, password_hash) VALUES ($1, $2, $3, $4, $5, 'active', $6)`,
          [id, personId, p.email, roleIds.get(p.role), p.owner ?? false, hash],
        );
      }
    }
    return id;
  });
  if (!companyId) {
    log('Demo company already exists; nothing to do.');
    return (await withSystem(db, async (tx) => (await tx.query<{ id: string }>('SELECT id FROM companies WHERE name = $1', [DEMO_COMPANY])).rows[0]!.id));
  }

  await withCompany(db, companyId, async (tx) => {
    const at = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
    // The Head of Operations is away; their approvals go to the CEO for a week.
    const liya = await asUser(tx, 'liya@demo.local');
    const hana = await asUser(tx, 'hana@demo.local');
    await tx.query('INSERT INTO delegations (company_id, from_user_id, to_user_id, ends_at, created_by) VALUES ($1, $2, $3, now() + interval \'7 days\', $2)', [companyId, liya.id, hana.id]);

    await upsertRequest(tx, companyId, msg({
      externalId: 'PAY-2026-10', kind: 'payroll', title: 'Payroll run · October', subtitle: 'Prepared by the HR officer',
      money: { amountMinor: 61_200_000, currency: 'ETB' },
      facts: [{ label: 'Employees', value: '46' }, { label: 'Change vs September', value: '+ETB 38,500' }, { label: 'Pay date', value: '31 Oct 2026' }],
      masked: [{ field: 'salary', ref: 'payroll/2026-10' }],
      partnerSteps: [{ label: 'Prepared and frozen', by: 'HR officer', at: at(30) }],
    }));
    // The CFO has already signed the payroll (signer 1 of 2).
    const payroll = (await tx.query<{ id: string; version: number }>(`SELECT id, version FROM requests WHERE external_id = 'PAY-2026-10'`)).rows[0]!;
    await decide(tx, await asUser(tx, 'mekdes@demo.local'), payroll.id, { decision: 'approve', version: payroll.version, reauthOk: true });

    await upsertRequest(tx, companyId, msg({
      externalId: 'LV-3381', kind: 'leave', title: 'Leave request · 5 days', subtitle: 'Ruth Kebede · Head of Sales', requesterEmployeeId: 'E-005', department: 'Sales',
      facts: [{ label: 'Dates', value: '3–7 Nov 2026' }, { label: 'Type', value: 'Annual leave' }, { label: 'Balance after', value: '9 days' }],
      partnerSteps: [{ label: 'Approved', by: 'Head of HR', at: at(3) }],
    }));
    await upsertRequest(tx, companyId, msg({
      externalId: 'EXP-0912', kind: 'expense', title: 'Expense claim · conference travel', subtitle: 'Mekdes Bekele · CFO', requesterEmployeeId: 'E-002', department: 'Finance',
      money: { amountMinor: 1_850_000, currency: 'ETB' },
      facts: [{ label: 'Purpose', value: 'Industry conference' }, { label: 'Receipts', value: '4 attached' }],
      partnerSteps: [{ label: 'Receipts checked', by: 'Finance', at: at(1) }],
    }));
    await upsertRequest(tx, companyId, msg({
      externalId: 'HIRE-0044', kind: 'hire', title: 'New hire · Junior developer', subtitle: 'Engineering', department: 'Engineering',
      facts: [{ label: 'Position', value: 'Budgeted, Q4' }, { label: 'Start date', value: '17 Nov 2026' }],
      masked: [{ field: 'salary', ref: 'offer/0044' }],
      partnerSteps: [{ label: 'Approved', by: 'Department head', at: at(30) }, { label: 'Approved', by: 'Head of HR', at: at(26) }],
    }));
    // Petty cash already checked by the HR system: small ones go to the Head of Operations only
    // (who is away, so the CEO sees them as a delegate); the large one also needs the CFO.
    for (const [n, who, amount, purpose] of [[1, 'Samuel Desta', 120_000, 'Team lunch'], [2, 'Meron Alemu', 85_000, 'Office supplies'], [3, 'Samuel Desta', 640_000, 'Hardware repair']] as const) {
      await upsertRequest(tx, companyId, msg({
        externalId: `PC-50${n}`, kind: 'petty_cash', title: `Petty cash · ${purpose}`, subtitle: who,
        money: { amountMinor: amount, currency: 'ETB' }, bulkEligible: true,
        facts: [{ label: 'Receipt', value: 'Attached' }, { label: 'Budget line', value: 'Within limit' }],
        partnerSteps: [{ label: 'Receipt checked', by: 'HR officer', at: at(4 + n) }],
      }));
    }
  });
  log(`Demo company created. Password for every account: ${DEMO_PASSWORD}`);
  return companyId;
}

if (process.argv[1]?.endsWith('seed.ts') || process.argv[1]?.endsWith('seed.js')) {
  const { loadEnvFile } = await import('./env.js');
  const { loadConfig } = await import('./config.js');
  const { createPool } = await import('./db.js');
  const { migrate } = await import('./migrate.js');
  loadEnvFile();
  const db = createPool(loadConfig().DATABASE_URL);
  await migrate(db);
  await seed(db);
  await db.end();
}
