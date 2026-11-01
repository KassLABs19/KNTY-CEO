import { createHash, randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';

export const ACCESS_TOKEN_SECONDS = 15 * 60;
export const REFRESH_TOKEN_DAYS = 30;

export interface AccessClaims {
  sub: string; // user id
  cid: string; // company id
  sid: string; // session id
}

const key = (secret: string) => new TextEncoder().encode(secret);

export async function signAccessToken(claims: AccessClaims, secret: string): Promise<string> {
  return new SignJWT({ cid: claims.cid, sid: claims.sid, typ: 'access' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TOKEN_SECONDS}s`)
    .sign(key(secret));
}

export async function verifyAccessToken(token: string, secret: string): Promise<AccessClaims> {
  const { payload } = await jwtVerify(token, key(secret), { algorithms: ['HS256'] });
  if (payload.typ !== 'access' || !payload.sub) throw new Error('Not an access token');
  return { sub: payload.sub, cid: String(payload.cid), sid: String(payload.sid) };
}

/** Short-lived token proving the password step passed; used for the two-step sign-in. */
export async function signChallengeToken(userId: string, setup: boolean, secret: string, appVersion: string) {
  return new SignJWT({ typ: '2fa', setup, appVersion })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(key(secret));
}

export async function verifyChallengeToken(token: string, secret: string) {
  const { payload } = await jwtVerify(token, key(secret), { algorithms: ['HS256'] });
  if (payload.typ !== '2fa' || !payload.sub) throw new Error('Not a sign-in challenge');
  return { userId: payload.sub, setup: Boolean(payload.setup), appVersion: String(payload.appVersion ?? '') };
}

/** Proof that the person typed their password again a moment ago. Bound to their session. */
export async function signReauthToken(userId: string, sessionId: string, minutes: number, secret: string) {
  return new SignJWT({ typ: 'reauth', sid: sessionId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${minutes * 60}s`)
    .sign(key(secret));
}

export async function reauthValid(token: string | undefined, userId: string, sessionId: string, secret: string): Promise<boolean> {
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, key(secret), { algorithms: ['HS256'] });
    return payload.typ === 'reauth' && payload.sub === userId && payload.sid === sessionId;
  } catch {
    return false;
  }
}

export function newRandomToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
