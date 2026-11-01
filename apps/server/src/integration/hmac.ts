import { createHmac, timingSafeEqual } from 'node:crypto';
import { SIGNATURE_MAX_AGE_SECONDS } from '@ceo/shared';

/** `t=<unix seconds>,v1=<hex HMAC-SHA256 of "${t}.${body}">` */
export function signBody(body: string, secret: string, now = Date.now()): string {
  const t = Math.floor(now / 1000);
  const v1 = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  return `t=${t},v1=${v1}`;
}

export function verifySignature(header: string | undefined, body: string, secret: string, now = Date.now()): 'ok' | 'missing' | 'too_old' | 'bad' {
  if (!header) return 'missing';
  const parts = Object.fromEntries(header.split(',').map((p) => p.trim().split('=') as [string, string]));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || !parts.v1) return 'bad';
  if (Math.abs(now / 1000 - t) > SIGNATURE_MAX_AGE_SECONDS) return 'too_old';
  const expected = createHmac('sha256', secret).update(`${t}.${body}`).digest();
  const given = Buffer.from(parts.v1, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected) ? 'ok' : 'bad';
}
