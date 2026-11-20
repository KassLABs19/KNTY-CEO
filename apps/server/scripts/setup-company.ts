/**
 * Sets up a new company on a server: its built-in roles, the starting request types and
 * reminder rules, the HR system connection with fresh secrets, and the first account owner with an invite link.
 *
 *   npm run setup:company -w @ceo/server -- --company "Acme Ltd" \
 *     --owner-name "Hana Tesfaye" --owner-email hana@acme.com --owner-employee-id E-001
 *
 * --owner-employee-id must be the owner's id in the HR system, so later HR messages
 * about them update this same person. Prints the HR system's partner id and secrets once:
 * set them in the HR system and keep them out of chat and email.
 */
import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import { DEFAULT_RULES, SYSTEM_ROLES } from '@ceo/shared';
import { loadEnvFile } from '../src/env.js';
import { loadConfig } from '../src/config.js';
import { createPool, withSystem } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { newRandomToken } from '../src/auth/tokens.js';
import { seedDefaultTypes } from '../src/request-types.js';

const { values } = parseArgs({
  options: {
    company: { type: 'string' },
    'owner-name': { type: 'string' },
    'owner-email': { type: 'string' },
    'owner-employee-id': { type: 'string' },
  },
});
const company = values.company;
const name = values['owner-name'];
const email = values['owner-email'];
const employeeId = values['owner-employee-id'];
if (!company || !name || !email || !employeeId) {
  console.error('Usage: setup-company --company NAME --owner-name NAME --owner-email EMAIL --owner-employee-id ID');
  process.exit(1);
}

loadEnvFile();
const config = loadConfig();
const db = createPool(config.DATABASE_URL);
await migrate(db, () => {});
const secret = () => randomBytes(32).toString('base64url');

const out = await withSystem(db, async (tx) => {
  if ((await tx.query('SELECT 1 FROM companies WHERE name = $1', [company])).rowCount) throw new Error(`A company called "${company}" already exists.`);
  const companyId = (await tx.query<{ id: string }>('INSERT INTO companies (name) VALUES ($1) RETURNING id', [company])).rows[0]!.id;
  let ceoRole = '';
  for (const r of SYSTEM_ROLES) {
    const id = (await tx.query<{ id: string }>(
      'INSERT INTO roles (company_id, key, name, scope, requires_2fa, levels, is_system) VALUES ($1, $2, $3, $4, $5, $6, true) RETURNING id',
      [companyId, r.key, r.name, r.scope, r.requires2fa, JSON.stringify(r.levels)],
    )).rows[0]!.id;
    if (r.key === 'ceo') ceoRole = id;
  }
  await tx.query('INSERT INTO settings (company_id, rules) VALUES ($1, $2)', [companyId, JSON.stringify(DEFAULT_RULES)]);
  await seedDefaultTypes(tx, companyId);
  const s = { inbound: secret(), outbound: secret() };
  const partnerId = (await tx.query<{ id: string }>(
    `INSERT INTO partners (company_id, system, name, inbound_secret, outbound_secret) VALUES ($1, 'hr', 'HR system', $2, $3) RETURNING id`,
    [companyId, s.inbound, s.outbound],
  )).rows[0]!.id;
  const hr = { partnerId, ...s };
  const personId = (await tx.query<{ id: string }>(
    'INSERT INTO people (company_id, employee_id, full_name, email) VALUES ($1, $2, $3, $4) RETURNING id',
    [companyId, employeeId, name, email],
  )).rows[0]!.id;
  const userId = (await tx.query<{ id: string }>(
    `INSERT INTO users (company_id, person_id, email, role_id, is_owner, status) VALUES ($1, $2, $3, $4, true, 'invited') RETURNING id`,
    [companyId, personId, email, ceoRole],
  )).rows[0]!.id;
  const invite = newRandomToken();
  await tx.query('INSERT INTO invites (company_id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)', [
    companyId, userId, invite.hash, new Date(Date.now() + config.INVITE_HOURS * 3600_000),
  ]);
  await tx.query(`INSERT INTO audit_log (company_id, action, category, detail) VALUES ($1, 'company.created', 'settings', $2)`, [companyId, JSON.stringify({ owner: email })]);
  return { companyId, hr, inviteLink: `kntyceo://invite/${invite.token}` };
});
await db.end();

console.log(`\nCompany "${company}" is ready (${out.companyId}).\n`);
console.log(`Owner invite for ${name} (works once, expires in ${config.INVITE_HOURS} hours):\n  ${out.inviteLink}\n`);
console.log('HR system credentials. Set these in the HR system now; they are not shown again:');
console.log(`\n    partner id:                 ${out.hr.partnerId}\n    secret it signs with:       ${out.hr.inbound}\n    secret it checks ours with: ${out.hr.outbound}`);
console.log('\nThen set the HR system address in Settings so decisions can be delivered. See docs/INTEGRATION.md.');
console.log('Request types (leave, payroll, hire, expense) start with default steps; owners can change them in Settings › Request types.');
