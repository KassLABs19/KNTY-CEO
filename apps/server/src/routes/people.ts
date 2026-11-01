import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { PersonRow } from '@ceo/shared';
import type { Config } from '../config.js';
import { withCompany, type Db, type Tx } from '../db.js';
import { requireAuth } from '../guard.js';
import { audit } from '../audit.js';
import { newRandomToken, reauthValid } from '../auth/tokens.js';
import { AppError } from '../errors.js';

const id = z.object({ id: z.string().uuid() });

async function activeOwners(tx: Tx): Promise<number> {
  return (await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM users WHERE is_owner AND status = 'active'`)).rows[0]!.n;
}

export function registerPeopleRoutes(app: FastifyInstance, db: Db, config: Config) {
  const owners = requireAuth(db, config.JWT_SECRET, { module: 'logins' });
  const signedIn = requireAuth(db, config.JWT_SECRET);
  const needReauth = async (req: FastifyRequest, what: string) => {
    const u = req.user!;
    if (!(await reauthValid(req.headers['x-reauth-token'] as string | undefined, u.id, u.sessionId, config.JWT_SECRET))) {
      throw new AppError(401, 'reauth_required', `Enter your password again to ${what}.`);
    }
  };

  app.get('/api/people', { preHandler: owners }, async (req) =>
    withCompany(db, req.user!.companyId, async (tx) => {
      const rows = (await tx.query<PersonRow>(
        `SELECT p.id, p.employee_id AS "employeeId", p.full_name AS "fullName", p.email, p.department, p.job_title AS "jobTitle",
                u.role_id AS "roleId", r.name AS "roleName", coalesce(u.status, 'none') AS login, coalesce(u.is_owner, false) AS "isOwner",
                p.needs_role_review AS "needsRoleReview", p.left_on::text AS "leftOn", coalesce(u.totp_enabled, false) AS "twoStep"
           FROM people p LEFT JOIN users u ON u.person_id = p.id LEFT JOIN roles r ON r.id = u.role_id
          ORDER BY (u.id IS NULL), p.full_name`,
      )).rows;
      return rows;
    }),
  );

  // Only people the HR system knows about, who haven't left, can be invited.
  app.post('/api/people/:id/invite', { preHandler: owners }, async (req) => {
    const { id: personId } = id.parse(req.params);
    const body = z.object({ roleId: z.string().uuid(), owner: z.boolean().default(false) }).safeParse(req.body);
    if (!body.success) throw new AppError(400, 'invalid_request', 'Choose a role.');
    const u = req.user!;
    if (body.data.owner) await needReauth(req, 'make someone an account owner');
    return withCompany(db, u.companyId, async (tx) => {
      const person = (await tx.query<{ id: string; email: string; full_name: string; left_on: string | null }>('SELECT id, email, full_name, left_on::text AS left_on FROM people WHERE id = $1', [personId])).rows[0];
      if (!person) throw new AppError(404, 'not_found', 'That person is not in the HR system.');
      if (person.left_on) throw new AppError(400, 'person_left', `${person.full_name} has left the company.`);
      const role = (await tx.query('SELECT id FROM roles WHERE id = $1', [body.data.roleId])).rows[0];
      if (!role) throw new AppError(400, 'invalid_role', 'That role doesn’t exist.');
      const existing = (await tx.query<{ id: string; status: string }>('SELECT id, status FROM users WHERE person_id = $1', [personId])).rows[0];
      if (existing && existing.status !== 'invited') throw new AppError(409, 'has_login', `${person.full_name} already has a login.`);
      const userId = existing
        ? (await tx.query<{ id: string }>('UPDATE users SET role_id = $2, is_owner = $3 WHERE id = $1 RETURNING id', [existing.id, body.data.roleId, body.data.owner])).rows[0]!.id
        : (await tx.query<{ id: string }>(
            `INSERT INTO users (company_id, person_id, email, role_id, is_owner, status) VALUES ($1, $2, $3, $4, $5, 'invited') RETURNING id`,
            [u.companyId, personId, person.email, body.data.roleId, body.data.owner],
          )).rows[0]!.id;
      await tx.query('UPDATE invites SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [userId]);
      const invite = newRandomToken();
      const expires = new Date(Date.now() + config.INVITE_HOURS * 3600_000);
      await tx.query('INSERT INTO invites (company_id, user_id, token_hash, expires_at, created_by) VALUES ($1, $2, $3, $4, $5)', [u.companyId, userId, invite.hash, expires, u.id]);
      await audit(tx, { companyId: u.companyId, actorUserId: u.id, action: 'logins.invited', category: 'logins', targetType: 'user', targetId: userId, ip: req.ip, detail: { person: person.full_name, owner: body.data.owner } });
      // The link is shown once to the owner, who sends it to the person.
      return { inviteToken: invite.token, inviteLink: `kntyceo://invite/${invite.token}`, expiresAt: expires.toISOString() };
    });
  });

  app.post('/api/users/:id/suspend', { preHandler: owners }, async (req, reply) => {
    const { id: userId } = id.parse(req.params);
    const u = req.user!;
    if (userId === u.id) throw new AppError(400, 'self', 'You can’t suspend yourself.');
    return withCompany(db, u.companyId, async (tx) => {
      const target = (await tx.query<{ is_owner: boolean; status: string }>('SELECT is_owner, status FROM users WHERE id = $1 FOR UPDATE', [userId])).rows[0];
      if (!target) throw new AppError(404, 'not_found', 'No such login.');
      if (target.is_owner && target.status === 'active' && (await activeOwners(tx)) <= 1) throw new AppError(400, 'last_owner', 'The company needs at least one active owner.');
      await tx.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [userId]);
      await tx.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
      await tx.query('UPDATE delegations SET ended_at = now() WHERE (from_user_id = $1 OR to_user_id = $1) AND ended_at IS NULL', [userId]);
      await audit(tx, { companyId: u.companyId, actorUserId: u.id, action: 'logins.suspended', category: 'logins', targetType: 'user', targetId: userId, ip: req.ip });
      return reply.status(204).send();
    });
  });

  app.post('/api/users/:id/reactivate', { preHandler: owners }, async (req, reply) => {
    const { id: userId } = id.parse(req.params);
    const u = req.user!;
    return withCompany(db, u.companyId, async (tx) => {
      const t = (await tx.query<{ left_on: string | null; password_hash: string | null }>(
        'SELECT p.left_on::text AS left_on, u.password_hash FROM users u JOIN people p ON p.id = u.person_id WHERE u.id = $1',
        [userId],
      )).rows[0];
      if (!t) throw new AppError(404, 'not_found', 'No such login.');
      if (t.left_on) throw new AppError(400, 'person_left', 'This person has left the company. The HR system must record a rehire first.');
      await tx.query(`UPDATE users SET status = CASE WHEN password_hash IS NULL THEN 'invited' ELSE 'active' END, locked_at = NULL, failed_attempts = 0 WHERE id = $1`, [userId]);
      await audit(tx, { companyId: u.companyId, actorUserId: u.id, action: 'logins.reactivated', category: 'logins', targetType: 'user', targetId: userId, ip: req.ip });
      return reply.status(204).send();
    });
  });

  app.post('/api/users/:id/unlock', { preHandler: owners }, async (req, reply) => {
    const { id: userId } = id.parse(req.params);
    const u = req.user!;
    return withCompany(db, u.companyId, async (tx) => {
      const res = await tx.query('UPDATE users SET locked_at = NULL, failed_attempts = 0 WHERE id = $1 AND locked_at IS NOT NULL', [userId]);
      if (res.rowCount === 0) throw new AppError(404, 'not_found', 'No locked account with that id.');
      await audit(tx, { companyId: u.companyId, actorUserId: u.id, action: 'logins.unlocked', category: 'security', targetType: 'user', targetId: userId, ip: req.ip });
      return reply.status(204).send();
    });
  });

  // Change someone's role (and clear a "review" flag from a job change).
  app.put('/api/users/:id/role', { preHandler: owners }, async (req, reply) => {
    const { id: userId } = id.parse(req.params);
    const body = z.object({ roleId: z.string().uuid() }).safeParse(req.body);
    if (!body.success) throw new AppError(400, 'invalid_request', 'Choose a role.');
    const u = req.user!;
    await needReauth(req, 'change someone’s role');
    return withCompany(db, u.companyId, async (tx) => {
      const res = await tx.query<{ person_id: string }>('UPDATE users SET role_id = $2 WHERE id = $1 RETURNING person_id', [userId, body.data.roleId]);
      if (res.rowCount === 0) throw new AppError(404, 'not_found', 'No such login.');
      await tx.query('UPDATE people SET needs_role_review = false WHERE id = $1', [res.rows[0]!.person_id]);
      await audit(tx, { companyId: u.companyId, actorUserId: u.id, action: 'access.role_changed', category: 'access', targetType: 'user', targetId: userId, ip: req.ip, detail: { roleId: body.data.roleId } });
      return reply.status(204).send();
    });
  });

  // Delegation while away. Anyone can hand their own approvals on; owners can set it for anyone.
  app.get('/api/delegations', { preHandler: signedIn }, async (req) => {
    const u = req.user!;
    return withCompany(db, u.companyId, async (tx) =>
      (await tx.query(
        `SELECT d.id, d.from_user_id AS "fromUserId", pf.full_name AS "from", d.to_user_id AS "toUserId", pt.full_name AS "to", d.ends_at AS "endsAt"
           FROM delegations d JOIN users f ON f.id = d.from_user_id JOIN people pf ON pf.id = f.person_id
           JOIN users t ON t.id = d.to_user_id JOIN people pt ON pt.id = t.person_id
          WHERE d.ended_at IS NULL AND d.ends_at > now() AND ($1 OR d.from_user_id = $2 OR d.to_user_id = $2)
          ORDER BY d.ends_at`,
        [u.isOwner, u.id],
      )).rows,
    );
  });

  app.post('/api/delegations', { preHandler: signedIn }, async (req) => {
    const body = z.object({ fromUserId: z.string().uuid().optional(), toUserId: z.string().uuid(), endsAt: z.string().datetime() }).safeParse(req.body);
    if (!body.success) throw new AppError(400, 'invalid_request', 'Choose a person and an end date.');
    const u = req.user!;
    const from = body.data.fromUserId ?? u.id;
    if (from !== u.id && !u.isOwner) throw new AppError(403, 'forbidden', 'Only owners can set up delegation for someone else.');
    if (from === body.data.toUserId) throw new AppError(400, 'self', 'Choose someone else.');
    const ends = new Date(body.data.endsAt);
    if (ends <= new Date()) throw new AppError(400, 'past', 'The end date must be in the future.');
    if (ends.getTime() - Date.now() > 60 * 86400_000) throw new AppError(400, 'too_long', 'A delegation can last at most 60 days.');
    return withCompany(db, u.companyId, async (tx) => {
      const to = (await tx.query<{ status: string }>('SELECT status FROM users WHERE id = $1', [body.data.toUserId])).rows[0];
      if (!to || to.status !== 'active') throw new AppError(400, 'inactive', 'That person has no active login.');
      const row = (await tx.query<{ id: string }>(
        'INSERT INTO delegations (company_id, from_user_id, to_user_id, ends_at, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [u.companyId, from, body.data.toUserId, ends, u.id],
      )).rows[0]!;
      await audit(tx, { companyId: u.companyId, actorUserId: u.id, action: 'delegation.started', category: 'access', targetType: 'delegation', targetId: row.id, ip: req.ip, detail: { from, to: body.data.toUserId, until: ends.toISOString() } });
      await tx.query(`INSERT INTO notifications (company_id, user_id, kind, text) VALUES ($1, $2, 'delegation', $3)`, [
        u.companyId, body.data.toUserId, `You now handle approvals for a colleague until ${ends.toISOString().slice(0, 10)}. Payroll signing is never delegated.`,
      ]);
      return row;
    });
  });

  app.delete('/api/delegations/:id', { preHandler: signedIn }, async (req, reply) => {
    const { id: delegationId } = id.parse(req.params);
    const u = req.user!;
    return withCompany(db, u.companyId, async (tx) => {
      const res = await tx.query('UPDATE delegations SET ended_at = now() WHERE id = $1 AND ended_at IS NULL AND ($2 OR from_user_id = $3)', [delegationId, u.isOwner, u.id]);
      if (res.rowCount === 0) throw new AppError(404, 'not_found', 'No active delegation of yours with that id.');
      await audit(tx, { companyId: u.companyId, actorUserId: u.id, action: 'delegation.ended', category: 'access', targetType: 'delegation', targetId: delegationId, ip: req.ip });
      return reply.status(204).send();
    });
  });
}
