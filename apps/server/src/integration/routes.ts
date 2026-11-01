import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ACCEPTED_MAJORS, SIGNATURE_HEADER, contractMajor, inboundMessage } from '@ceo/shared';
import { withCompany, withSystem, type Db } from '../db.js';
import { AppError } from '../errors.js';
import { cancelRequest, upsertRequest } from '../approvals.js';
import { applyPeopleEvent } from '../people.js';
import { verifySignature } from './hmac.js';

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: string;
  }
}

/**
 * The one door partner systems use: POST /api/integration/inbound with headers
 * `x-cc-partner: <partner id>` and `x-cc-signature`. Messages are checked, de-duplicated
 * by messageId and applied in one transaction, so a retried message never acts twice.
 */
export async function registerIntegrationRoutes(app: FastifyInstance, db: Db) {
  await app.register(async (scope) => {
    // Keep the exact bytes: the signature is over the raw body.
    scope.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
      req.rawBody = body as string;
      try {
        done(null, JSON.parse(body as string));
      } catch {
        done(new AppError(400, 'invalid_json', 'The body is not valid JSON.'), undefined);
      }
    });

    scope.post('/api/integration/inbound', { config: { rateLimit: { max: 600, timeWindow: '1 minute' } } }, async (req, reply) => {
      const partnerId = z.string().uuid().safeParse(req.headers['x-cc-partner']);
      if (!partnerId.success) return reply.status(401).send({ error: 'unknown_partner', message: 'Missing or unknown x-cc-partner.' });
      const partner = await withSystem(db, async (tx) =>
        (await tx.query<{ id: string; company_id: string; system: 'hr' | 'predicto'; inbound_secret: string }>(
          'SELECT id, company_id, system, inbound_secret FROM partners WHERE id = $1',
          [partnerId.data],
        )).rows[0],
      );
      if (!partner) return reply.status(401).send({ error: 'unknown_partner', message: 'Missing or unknown x-cc-partner.' });

      const check = verifySignature(req.headers[SIGNATURE_HEADER] as string | undefined, req.rawBody ?? '', partner.inbound_secret);
      if (check !== 'ok') return reply.status(401).send({ error: `signature_${check}`, message: 'The message signature could not be verified.' });

      const parsed = inboundMessage.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'invalid_message', message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
      }
      const msg = parsed.data;
      if (msg.system !== partner.system) return reply.status(400).send({ error: 'wrong_system', message: 'The message system does not match this partner.' });
      if (!ACCEPTED_MAJORS.includes(contractMajor(msg.contractVersion))) {
        return reply.status(400).send({ error: 'contract_version', message: `Contract ${msg.contractVersion} is not accepted. Supported majors: ${ACCEPTED_MAJORS.join(', ')}.` });
      }
      if (msg.type === 'people.event' && msg.system !== 'hr') return reply.status(400).send({ error: 'wrong_system', message: 'Only the HR system sends people events.' });

      return withCompany(db, partner.company_id, async (tx) => {
        const fresh = await tx.query('INSERT INTO inbox (company_id, system, message_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [
          partner.company_id, msg.system, msg.messageId,
        ]);
        await tx.query('UPDATE partners SET last_message_at = now(), contract_version = $2 WHERE id = $1', [partner.id, msg.contractVersion]);
        if (fresh.rowCount === 0) return { status: 'duplicate' };
        if (msg.type === 'request.upsert') {
          const res = await upsertRequest(tx, partner.company_id, msg);
          // Throwing rolls the inbox row back too, so the partner can resend once the rules change.
          if (res.status === 'not_routed') throw new AppError(422, 'not_routed', 'This kind of request has no Control Center steps under the current rules.');
          return res;
        }
        if (msg.type === 'request.cancel') return { status: await cancelRequest(tx, partner.company_id, msg) };
        await applyPeopleEvent(tx, partner.company_id, msg);
        return { status: 'applied' };
      });
    });
  });
}
