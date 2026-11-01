import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { isVersionSupported, type InviteInfo, type LoginResponse, type ReauthResponse, type SessionTokens } from '@ceo/shared';
import type { Config } from '../config.js';
import { withCompany, withSystem, type Db, type Tx } from '../db.js';
import { audit } from '../audit.js';
import { requireAuth } from '../guard.js';
import { dummyHash, hashPassword, passwordProblem, verifyPassword } from './password.js';
import { newTotpSecret, otpauthUrl, verifyTotp } from './totp.js';
import {
  ACCESS_TOKEN_SECONDS,
  REFRESH_TOKEN_DAYS,
  hashToken,
  newRandomToken,
  signAccessToken,
  signChallengeToken,
  signReauthToken,
  verifyChallengeToken,
} from './tokens.js';

const loginBody = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(200),
  appVersion: z.string().max(40),
});
const twoFactorBody = z.object({ challengeToken: z.string().min(10), code: z.string().regex(/^\s*\d{3}\s?\d{3}\s*$/) });
const tokenBody = z.object({ refreshToken: z.string().min(10).optional().nullable() });

interface UserRow {
  id: string;
  company_id: string;
  email: string;
  password_hash: string | null;
  status: string;
  failed_attempts: number;
  locked_at: Date | null;
  totp_secret: string | null;
  totp_enabled: boolean;
  requires_2fa: boolean;
  left_on: string | null;
}

const USER_SQL = `SELECT u.id, u.company_id, u.email, u.password_hash, u.status, u.failed_attempts, u.locked_at,
  u.totp_secret, u.totp_enabled, (r.requires_2fa OR u.is_owner) AS requires_2fa, p.left_on::text AS left_on
  FROM users u JOIN roles r ON r.id = u.role_id JOIN people p ON p.id = u.person_id`;

function fail(reply: FastifyReply, status: number, error: string, message: string) {
  return reply.status(status).send({ error, message });
}

export function registerAuthRoutes(app: FastifyInstance, db: Db, config: Config) {
  const ip = (req: FastifyRequest) => req.ip;
  const limited = { config: { rateLimit: { max: config.LOGIN_RATE_LIMIT, timeWindow: '1 minute' } } };

  async function issueSession(tx: Tx, user: Pick<UserRow, 'id' | 'company_id'>, appVersion: string): Promise<SessionTokens> {
    const refresh = newRandomToken();
    const expires = new Date(Date.now() + REFRESH_TOKEN_DAYS * 86400_000);
    const { rows } = await tx.query<{ id: string }>(
      'INSERT INTO sessions (company_id, user_id, refresh_hash, app_version, expires_at) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [user.company_id, user.id, refresh.hash, appVersion, expires],
    );
    await tx.query('UPDATE users SET last_login_at = now(), failed_attempts = 0 WHERE id = $1', [user.id]);
    const accessToken = await signAccessToken({ sub: user.id, cid: user.company_id, sid: rows[0]!.id }, config.JWT_SECRET);
    return { accessToken, refreshToken: refresh.token, expiresIn: ACCESS_TOKEN_SECONDS };
  }

  async function countFailure(tx: Tx, user: UserRow, base: { companyId: string; actorUserId: string; ip: string }, what: string) {
    const attempts = user.failed_attempts + 1;
    const lock = attempts >= config.LOCK_AFTER_FAILED_ATTEMPTS;
    await tx.query('UPDATE users SET failed_attempts = $2, locked_at = CASE WHEN $3 THEN now() ELSE locked_at END WHERE id = $1', [user.id, attempts, lock]);
    await audit(tx, { ...base, action: lock ? 'auth.account_locked' : what, category: 'security', detail: { attempts } });
    if (lock) {
      // Tell every owner straight away: a lock can mean someone is guessing passwords.
      await tx.query(
        `INSERT INTO notifications (company_id, user_id, kind, text)
         SELECT company_id, id, 'security', $2 FROM users WHERE is_owner AND status = 'active' AND id <> $1`,
        [user.id, `An account (${user.email}) was locked after ${attempts} failed sign-in attempts.`],
      );
    }
    return lock;
  }

  app.post('/api/auth/login', limited, async (req, reply) => {
    const parsed = loginBody.safeParse(req.body);
    if (!parsed.success) return fail(reply, 400, 'invalid_request', 'Enter your email and password.');
    const { email, password, appVersion } = parsed.data;
    if (!isVersionSupported(appVersion, config.MIN_DESKTOP_VERSION)) {
      return fail(reply, 426, 'update_required', `This version of the app is no longer supported. Update to ${config.MIN_DESKTOP_VERSION} or later.`);
    }

    const user = await withSystem(db, async (tx) => (await tx.query<UserRow>(`${USER_SQL} WHERE lower(u.email) = lower($1)`, [email])).rows[0]);
    const passwordOk = await verifyPassword(password, user?.password_hash ?? (await dummyHash()));
    const generic = 'That email and password don’t match.';
    if (!user) return fail(reply, 401, 'invalid_credentials', generic);

    return withCompany(db, user.company_id, async (tx) => {
      const base = { companyId: user.company_id, actorUserId: user.id, ip: ip(req) };
      if (user.locked_at) {
        await audit(tx, { ...base, action: 'auth.login_blocked_locked', category: 'security' });
        return fail(reply, 423, 'account_locked', 'This account is locked after too many failed attempts. Ask an account owner to unlock it.');
      }
      if (user.status !== 'active' || !user.password_hash) {
        await audit(tx, { ...base, action: 'auth.login_blocked_status', category: 'security', detail: { status: user.status } });
        return fail(reply, 401, 'invalid_credentials', generic);
      }
      if (!passwordOk) {
        const locked = await countFailure(tx, user, base, 'auth.login_failed');
        return locked
          ? fail(reply, 423, 'account_locked', 'Too many failed attempts. This account is now locked; an account owner can unlock it.')
          : fail(reply, 401, 'invalid_credentials', generic);
      }
      if (user.requires_2fa || user.totp_enabled) {
        if (!user.totp_enabled) {
          const secret = user.totp_secret ?? newTotpSecret();
          if (!user.totp_secret) await tx.query('UPDATE users SET totp_secret = $2 WHERE id = $1', [user.id, secret]);
          const res: LoginResponse = {
            step: '2fa-setup',
            challengeToken: await signChallengeToken(user.id, true, config.JWT_SECRET, appVersion),
            otpauthUrl: otpauthUrl(user.email, secret),
            secret,
          };
          return res;
        }
        const res: LoginResponse = { step: '2fa', challengeToken: await signChallengeToken(user.id, false, config.JWT_SECRET, appVersion) };
        return res;
      }
      const session = await issueSession(tx, user, appVersion);
      await audit(tx, { ...base, action: 'auth.login', category: 'logins' });
      const res: LoginResponse = { step: 'done', session };
      return res;
    });
  });

  app.post('/api/auth/2fa', limited, async (req, reply) => {
    const parsed = twoFactorBody.safeParse(req.body);
    if (!parsed.success) return fail(reply, 400, 'invalid_request', 'Enter the 6-digit code.');
    let challenge;
    try {
      challenge = await verifyChallengeToken(parsed.data.challengeToken, config.JWT_SECRET);
    } catch {
      return fail(reply, 401, 'challenge_expired', 'This sign-in took too long. Start again.');
    }
    const user = await withSystem(db, async (tx) => (await tx.query<UserRow>(`${USER_SQL} WHERE u.id = $1`, [challenge.userId])).rows[0]);
    if (!user || !user.totp_secret || user.locked_at || user.status !== 'active') return fail(reply, 401, 'invalid_credentials', 'Sign-in failed. Start again.');
    return withCompany(db, user.company_id, async (tx) => {
      const base = { companyId: user.company_id, actorUserId: user.id, ip: ip(req) };
      if (!verifyTotp(parsed.data.code, user.totp_secret!)) {
        const locked = await countFailure(tx, user, base, 'auth.2fa_failed');
        return fail(reply, locked ? 423 : 401, locked ? 'account_locked' : 'invalid_code', locked ? 'Too many failed attempts. This account is now locked.' : 'That code isn’t right. Try the newest one.');
      }
      if (challenge.setup) {
        await tx.query('UPDATE users SET totp_enabled = true WHERE id = $1', [user.id]);
        await audit(tx, { ...base, action: 'auth.2fa_enabled', category: 'security' });
      }
      const session = await issueSession(tx, user, challenge.appVersion);
      await audit(tx, { ...base, action: 'auth.login', category: 'logins', detail: { twoStep: true } });
      return session;
    });
  });

  app.post('/api/auth/refresh', async (req, reply) => {
    const parsed = tokenBody.safeParse(req.body ?? {});
    const token = parsed.success ? parsed.data.refreshToken : null;
    if (!token) return fail(reply, 401, 'signed_out', 'Please sign in.');
    const session = await withSystem(db, async (tx) =>
      (await tx.query<{ id: string; company_id: string; user_id: string; app_version: string | null; last_used_at: Date; expires_at: Date; revoked_at: Date | null }>(
        'SELECT id, company_id, user_id, app_version, last_used_at, expires_at, revoked_at FROM sessions WHERE refresh_hash = $1',
        [hashToken(token)],
      )).rows[0],
    );
    const idleLimit = config.SIGN_OUT_AFTER_IDLE_MINUTES * 60_000;
    if (!session || session.revoked_at || session.expires_at < new Date() || Date.now() - session.last_used_at.getTime() > idleLimit) {
      return fail(reply, 401, 'signed_out', 'You were signed out. Please sign in again.');
    }
    return withCompany(db, session.company_id, async (tx) => {
      const user = (await tx.query<UserRow>(`${USER_SQL} WHERE u.id = $1`, [session.user_id])).rows[0];
      // Rotate: the old refresh token stops working whatever happens next.
      await tx.query('UPDATE sessions SET revoked_at = now() WHERE id = $1', [session.id]);
      if (!user || user.locked_at || user.status !== 'active') return fail(reply, 401, 'signed_out', 'Please sign in again.');
      return issueSession(tx, user, session.app_version ?? '0.0.0');
    });
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const parsed = tokenBody.safeParse(req.body ?? {});
    const token = parsed.success ? parsed.data.refreshToken : null;
    if (token) await withSystem(db, (tx) => tx.query('UPDATE sessions SET revoked_at = now() WHERE refresh_hash = $1 AND revoked_at IS NULL', [hashToken(token)]));
    return reply.status(204).send();
  });

  // Re-enter the password before a sensitive action (signing payroll, changing access, settings).
  app.post('/api/auth/reauth', { ...limited, preHandler: requireAuth(db, config.JWT_SECRET) }, async (req, reply) => {
    const parsed = z.object({ password: z.string().min(1).max(200) }).safeParse(req.body);
    if (!parsed.success) return fail(reply, 400, 'invalid_request', 'Enter your password.');
    const u = req.user!;
    return withCompany(db, u.companyId, async (tx) => {
      const user = (await tx.query<UserRow>(`${USER_SQL} WHERE u.id = $1`, [u.id])).rows[0]!;
      const base = { companyId: u.companyId, actorUserId: u.id, ip: ip(req) };
      if (!(await verifyPassword(parsed.data.password, user.password_hash ?? (await dummyHash())))) {
        const locked = await countFailure(tx, user, base, 'auth.reauth_failed');
        if (locked) await tx.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [u.id]);
        return fail(reply, locked ? 423 : 401, locked ? 'account_locked' : 'invalid_credentials', locked ? 'Too many failed attempts. This account is now locked.' : 'That password isn’t right.');
      }
      await tx.query('UPDATE users SET failed_attempts = 0 WHERE id = $1', [u.id]);
      const res: ReauthResponse = { reauthToken: await signReauthToken(u.id, u.sessionId, config.REAUTH_MINUTES, config.JWT_SECRET), expiresIn: config.REAUTH_MINUTES * 60 };
      return res;
    });
  });

  // Invite links: an owner creates them (see routes/people.ts); the invited person sets a password here.
  const findInvite = (token: string) =>
    withSystem(db, async (tx) =>
      (await tx.query<{ id: string; company_id: string; user_id: string; expires_at: Date; used_at: Date | null; full_name: string; email: string; role_name: string; requires_2fa: boolean; status: string; left_on: string | null }>(
        `SELECT i.id, i.company_id, i.user_id, i.expires_at, i.used_at, p.full_name, u.email, r.name AS role_name,
                (r.requires_2fa OR u.is_owner) AS requires_2fa, u.status, p.left_on::text AS left_on
           FROM invites i JOIN users u ON u.id = i.user_id JOIN people p ON p.id = u.person_id JOIN roles r ON r.id = u.role_id
          WHERE i.token_hash = $1`,
        [hashToken(token)],
      )).rows[0],
    );
  const inviteUsable = (i: Awaited<ReturnType<typeof findInvite>>) => i && !i.used_at && i.expires_at > new Date() && i.status === 'invited' && !i.left_on;

  app.get('/api/invites/:token', limited, async (req, reply) => {
    const { token } = req.params as { token: string };
    const invite = await findInvite(token);
    if (!inviteUsable(invite)) return fail(reply, 404, 'invite_invalid', 'This invite link has expired or was already used. Ask an account owner to send a new one.');
    const info: InviteInfo = { fullName: invite!.full_name, email: invite!.email, roleName: invite!.role_name, requires2fa: invite!.requires_2fa };
    return info;
  });

  app.post('/api/invites/accept', limited, async (req, reply) => {
    const parsed = z.object({ token: z.string().min(10).max(200), password: z.string().min(1).max(200) }).safeParse(req.body);
    if (!parsed.success) return fail(reply, 400, 'invalid_request', 'Enter a password.');
    const problem = passwordProblem(parsed.data.password);
    if (problem) return fail(reply, 400, 'weak_password', problem);
    const invite = await findInvite(parsed.data.token);
    if (!inviteUsable(invite)) return fail(reply, 404, 'invite_invalid', 'This invite link has expired or was already used. Ask an account owner to send a new one.');
    const hash = await hashPassword(parsed.data.password);
    return withCompany(db, invite!.company_id, async (tx) => {
      // The invite is single-use: claim it first so two attempts can't both succeed.
      const claimed = await tx.query('UPDATE invites SET used_at = now() WHERE id = $1 AND used_at IS NULL', [invite!.id]);
      if (claimed.rowCount !== 1) return fail(reply, 404, 'invite_invalid', 'This invite link was already used.');
      await tx.query(`UPDATE users SET password_hash = $2, status = 'active', failed_attempts = 0 WHERE id = $1`, [invite!.user_id, hash]);
      await audit(tx, { companyId: invite!.company_id, actorUserId: invite!.user_id, action: 'logins.invite_accepted', category: 'logins', ip: ip(req) });
      return reply.status(204).send();
    });
  });
}
