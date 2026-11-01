import type { FastifyReply, FastifyRequest } from 'fastify';
import { canAccess, type Level, type Levels, type Module, type RoleKey, type Scope } from '@ceo/shared';
import { withCompany, type Db } from './db.js';
import { verifyAccessToken } from './auth/tokens.js';

export interface CurrentUser {
  id: string;
  companyId: string;
  sessionId: string;
  personId: string;
  fullName: string;
  department: string | null;
  isOwner: boolean;
  role: { id: string; key: RoleKey | null; name: string; scope: Scope; levels: Levels };
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: CurrentUser;
  }
}

/**
 * Checks the access token, then reloads the person, role and session from the database,
 * so a suspension, a leaver event or an access change applies straight away, not when
 * the token runs out.
 */
export function requireAuth(db: Db, secret: string, need?: { module: Module; min?: Level }) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) return reply.status(401).send({ error: 'signed_out', message: 'Please sign in.' });
    let claims;
    try {
      claims = await verifyAccessToken(token, secret);
    } catch {
      return reply.status(401).send({ error: 'token_expired', message: 'Your session expired.' });
    }
    const row = await withCompany(db, claims.cid, async (tx) =>
      (await tx.query<{
        status: string; locked_at: Date | null; is_owner: boolean; revoked_at: Date | null; person_id: string; full_name: string;
        department: string | null; left_on: string | null; rid: string; key: RoleKey | null; name: string; scope: Scope; levels: Levels;
      }>(
        `SELECT u.status, u.locked_at, u.is_owner, s.revoked_at, p.id AS person_id, p.full_name, p.department, p.left_on::text AS left_on,
                r.id AS rid, r.key, r.name, r.scope, r.levels
           FROM users u JOIN people p ON p.id = u.person_id JOIN roles r ON r.id = u.role_id JOIN sessions s ON s.id = $2 AND s.user_id = u.id
          WHERE u.id = $1`,
        [claims.sub, claims.sid],
      )).rows[0],
    );
    if (!row || row.status !== 'active' || row.locked_at || row.revoked_at) {
      return reply.status(401).send({ error: 'signed_out', message: 'Please sign in again.' });
    }
    req.user = {
      id: claims.sub,
      companyId: claims.cid,
      sessionId: claims.sid,
      personId: row.person_id,
      fullName: row.full_name,
      department: row.department,
      isOwner: row.is_owner,
      role: { id: row.rid, key: row.key, name: row.name, scope: row.scope, levels: row.levels },
    };
    if (need && !canAccess({ isOwner: row.is_owner, levels: row.levels }, need.module, need.min ?? 1)) {
      return reply.status(403).send({ error: 'forbidden', message: 'Your role doesn’t include this.' });
    }
  };
}
