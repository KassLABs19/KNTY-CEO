/**
 * Sets up a new company on a server: its built-in roles, default approval rules, the two
 * partner systems with fresh secrets, and the first account owner with an invite link.
 *
 *   npm run setup:company -w @ceo/server -- --company "Acme Ltd" \
 *     --owner-name "Hana Tesfaye" --owner-email hana@acme.com --owner-employee-id E-001
 *
 * --owner-employee-id must be the owner's id in the HR system, so later HR messages
 * about them update this same person. Prints the partner ids and secrets once: give each
 * partner system its own pair and keep them out of chat and email.
 */
import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import { DEFAULT_RULES, SYSTEM_ROLES } from '@ceo/shared';
import { loadEnvFile } from '../src/env.js';
import { loadConfig } from '../src/config.js';
import { createPool, withSystem } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { newRandomToken } from '../src/auth/tokens.js';

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
  const partners = [];
  for (const [system, label] of [['hr', 'HR system'], ['predicto', 'Predicto']] as const) {
    const s = { inbound: secret(), outbound: secret() };
    const id = (await tx.query<{ id: string }>(
      'INSERT INTO partners (company_id, system, name, inbound_secret, outbound_secret) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [companyId, system, label, s.inbound, s.outbound],
    )).rows[0]!.id;
    partners.push({ system: label, partnerId: id, ...s });
  }
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
  return { companyId, partners, inviteLink: `kntyceo://invite/${invite.token}` };
});
await db.end();

console.log(`\nCompany "${company}" is ready (${out.companyId}).\n`);
console.log(`Owner invite for ${name} (works once, expires in ${config.INVITE_HOURS} hours):\n  ${out.inviteLink}\n`);
console.log('Partner credentials. Set these in each partner system now; they are not shown again:');
for (const p of out.partners) {
  console.log(`\n  ${p.system}\n    partner id:                 ${p.partnerId}\n    secret it signs with:       ${p.inbound}\n    secret it checks ours with: ${p.outbound}`);
}
console.log('\nThen set each partner\'s address (base_url) so decisions can be delivered. See docs/INTEGRATION.md.');
