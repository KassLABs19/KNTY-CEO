import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { BULK_KINDS } from '@ceo/shared';
import type { Config } from '../config.js';
import { withCompany, type Db } from '../db.js';
import { requireAuth } from '../guard.js';
import { reauthValid } from '../auth/tokens.js';
import { canSee, decide, loadRules, loadSteps, type RequestRow } from '../approvals.js';
import { AppError, outcome } from '../errors.js';
import { detail, summarize } from '../views.js';

const decideBody = z.object({
  decision: z.enum(['approve', 'reject', 'send_back']),
  version: z.number().int().positive(),
  note: z.string().max(1000).optional(),
});

export function registerRequestRoutes(app: FastifyInstance, db: Db, config: Config) {
  const auth = requireAuth(db, config.JWT_SECRET, { module: 'approvals', min: 1 });

  app.get('/api/requests', { preHandler: auth }, async (req) => {
    const { filter } = z.object({ filter: z.enum(['mine', 'all', 'hr', 'predicto', 'decided']).default('mine') }).parse(req.query);
    const u = req.user!;
    return withCompany(db, u.companyId, async (tx) => {
      const rules = await loadRules(tx);
      const where = {
        mine: `status = 'pending'`,
        all: 'true',
        hr: `system = 'hr'`,
        predicto: `system = 'predicto'`,
        decided: `status IN ('approved', 'rejected', 'returned', 'cancelled')`,
      }[filter];
      const rows = (await tx.query<RequestRow>(`SELECT * FROM requests WHERE ${where} ORDER BY updated_at DESC LIMIT 300`)).rows;
      const out = [];
      for (const r of rows) {
        const steps = await loadSteps(tx, r.id);
        if (!(await canSee(tx, u, r, steps))) continue;
        const s = await summarize(tx, u, r, steps, rules.remindAfterHours);
        if (filter === 'mine' && !s.yourTurn) continue;
        out.push(s);
      }
      return out;
    });
  });

  app.get('/api/requests/:id', { preHandler: auth }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const u = req.user!;
    return withCompany(db, u.companyId, async (tx) => {
      const r = (await tx.query<RequestRow>('SELECT * FROM requests WHERE id = $1', [id])).rows[0];
      if (!r || !(await canSee(tx, u, r, await loadSteps(tx, r.id)))) return outcome(404, 'not_found', 'Request not found.');
      return detail(tx, u, r);
    });
  });

  app.post('/api/requests/:id/decide', { preHandler: auth }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = decideBody.safeParse(req.body);
    if (!body.success) throw new AppError(400, 'invalid_request', 'Choose approve, reject or send back.');
    const u = req.user!;
    const reauthOk = await reauthValid(req.headers['x-reauth-token'] as string | undefined, u.id, u.sessionId, config.JWT_SECRET);
    return withCompany(db, u.companyId, async (tx) => {
      const updated = await decide(tx, u, id, { ...body.data, reauthOk, ip: req.ip });
      return detail(tx, u, updated);
    });
  });

  // Bulk approval: only for kinds the partner already checked (manual payments whose
  // reference and phone passed). Each item is decided on its own, in its own transaction.
  app.post('/api/requests/bulk-approve', { preHandler: auth }, async (req) => {
    const body = z.object({ items: z.array(z.object({ id: z.string().uuid(), version: z.number().int().positive() })).min(1).max(50) }).safeParse(req.body);
    if (!body.success) throw new AppError(400, 'invalid_request', 'Choose between 1 and 50 requests.');
    const u = req.user!;
    const approved: string[] = [];
    const failed: { id: string; message: string }[] = [];
    for (const item of body.data.items) {
      try {
        await withCompany(db, u.companyId, async (tx) => {
          const r = (await tx.query<RequestRow>('SELECT kind, bulk_eligible FROM requests WHERE id = $1', [item.id])).rows[0];
          if (!r || !r.bulk_eligible || !BULK_KINDS.includes(r.kind)) throw new AppError(400, 'not_bulk', 'This request can’t be approved in bulk. Open it to decide.');
          await decide(tx, u, item.id, { decision: 'approve', version: item.version, reauthOk: false, ip: req.ip });
        });
        approved.push(item.id);
      } catch (err) {
        failed.push({ id: item.id, message: err instanceof AppError ? err.message : 'Could not approve this one.' });
      }
    }
    return { approved, failed };
  });
}
