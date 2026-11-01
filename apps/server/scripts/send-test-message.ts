/**
 * Sends one signed test message to a KNTY CEO server, the way a partner system would.
 * Useful when connecting the HR system or Predicto for the first time.
 *
 *   npm run send:test -w @ceo/server -- --server http://localhost:8090 \
 *     --partner <partner id> --secret <secret it signs with> --system hr
 *
 * Without --partner and --secret it uses the demo company's HR system (after db:seed).
 */
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { CONTRACT_VERSION, SIGNATURE_HEADER } from '@ceo/shared';
import { signBody } from '../src/integration/hmac.js';
import { DEMO_PARTNER_SECRETS } from '../src/seed.js';

const { values } = parseArgs({
  options: {
    server: { type: 'string', default: 'http://localhost:8090' },
    partner: { type: 'string' },
    secret: { type: 'string' },
    system: { type: 'string', default: 'hr' },
  },
});
const system = values.system === 'predicto' ? 'predicto' : 'hr';
let partner = values.partner;
if (!partner) {
  const { loadEnvFile } = await import('../src/env.js');
  const { loadConfig } = await import('../src/config.js');
  const { createPool, withSystem } = await import('../src/db.js');
  loadEnvFile();
  const db = createPool(loadConfig().DATABASE_URL);
  partner = await withSystem(db, async (tx) =>
    (await tx.query<{ id: string }>(`SELECT p.id FROM partners p JOIN companies c ON c.id = p.company_id WHERE c.name = 'Demo Company' AND p.system = $1`, [system])).rows[0]?.id,
  );
  await db.end();
  if (!partner) throw new Error('No demo company found. Run npm run db:seed first, or pass --partner and --secret.');
}
const secret = values.secret ?? DEMO_PARTNER_SECRETS[system].inbound;
const ext = `TEST-${Date.now()}`;
const body = JSON.stringify({
  messageId: randomUUID(),
  system,
  contractVersion: CONTRACT_VERSION,
  sentAt: new Date().toISOString(),
  traceId: randomUUID().slice(0, 8),
  type: 'request.upsert',
  request: system === 'hr'
    ? { externalId: ext, version: 1, kind: 'hire', title: 'New hire · Test request', subtitle: 'Sent by send-test-message', department: 'Engineering' }
    : { externalId: ext, version: 1, kind: 'manual_payment', title: 'Manual payment · Test', subtitle: 'Sent by send-test-message', money: { amountMinor: 10_000, currency: 'ETB' }, bulkEligible: true },
});
const res = await fetch(`${values.server}/api/integration/inbound`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-cc-partner': partner, [SIGNATURE_HEADER]: signBody(body, secret) },
  body,
});
console.log(res.status, await res.text());
