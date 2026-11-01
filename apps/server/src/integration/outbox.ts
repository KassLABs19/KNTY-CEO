import { SIGNATURE_HEADER } from '@ceo/shared';
import { withSystem, type Db } from '../db.js';
import { signBody } from './hmac.js';

/** Wait before retry number n (1-based): 1, 5 and 30 minutes, then every hour. */
export function backoffMinutes(attempt: number): number {
  return [1, 5, 30][attempt - 1] ?? 60;
}

/** Owners are told when a message is still undelivered after this long. */
export const ALERT_AFTER_HOURS = 6;

export type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number }>;

/**
 * Delivers due outbox messages. Each one is leased for two minutes first, so a second
 * worker never sends the same message at the same time, and the network call happens
 * outside any database transaction.
 */
export async function deliverDue(db: Db, fetchFn: Fetch, limit = 20): Promise<{ delivered: number; failed: number }> {
  const batch = await withSystem(db, async (tx) =>
    (await tx.query<{ id: string; system: string; message_id: string; payload: unknown; attempts: number; base_url: string | null; outbound_secret: string; partner_id: string }>(
      `UPDATE outbox o SET next_try_at = now() + interval '2 minutes'
         FROM partners p
        WHERE o.id IN (SELECT id FROM outbox WHERE delivered_at IS NULL AND next_try_at <= now() ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED)
          AND p.company_id = o.company_id AND p.system = o.system
        RETURNING o.id, o.system, o.message_id, o.payload, o.attempts, p.base_url, p.outbound_secret, p.id AS partner_id`,
      [limit],
    )).rows,
  );
  let delivered = 0;
  let failed = 0;
  for (const m of batch) {
    let error: string | null = null;
    if (!m.base_url) error = 'No address is set for this partner yet.';
    else {
      const body = JSON.stringify(m.payload);
      try {
        const res = await fetchFn(`${m.base_url.replace(/\/+$/, '')}/cc/inbound`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', [SIGNATURE_HEADER]: signBody(body, m.outbound_secret), 'x-cc-message-id': m.message_id },
          body,
        });
        if (!res.ok) error = `The partner answered ${res.status}.`;
      } catch (err) {
        error = `Could not reach the partner: ${(err as Error).message}`;
      }
    }
    await withSystem(db, (tx) =>
      error
        ? tx.query(`UPDATE outbox SET attempts = attempts + 1, last_error = $2, next_try_at = now() + make_interval(mins => $3) WHERE id = $1`, [
            m.id, error, backoffMinutes(m.attempts + 1),
          ])
        : tx.query('UPDATE outbox SET attempts = attempts + 1, delivered_at = now(), last_error = NULL WHERE id = $1', [m.id]),
    );
    if (error) failed++;
    else delivered++;
  }
  return { delivered, failed };
}

/** Tells owners about messages stuck for longer than ALERT_AFTER_HOURS, once per message. */
export async function alertStuck(db: Db): Promise<number> {
  return withSystem(db, async (tx) => {
    const stuck = (await tx.query<{ id: string; company_id: string; system: string; trace_id: string }>(
      `UPDATE outbox SET alerted_at = now()
        WHERE delivered_at IS NULL AND alerted_at IS NULL AND created_at < now() - make_interval(hours => $1)
        RETURNING id, company_id, system, trace_id`,
      [ALERT_AFTER_HOURS],
    )).rows;
    for (const s of stuck) {
      const name = s.system === 'hr' ? 'the HR system' : 'Predicto';
      await tx.query(
        `INSERT INTO notifications (company_id, user_id, kind, text)
         SELECT $1, id, 'security', $2 FROM users WHERE company_id = $1 AND is_owner AND status = 'active'`,
        [s.company_id, `A decision for ${name} has not been delivered for ${ALERT_AFTER_HOURS} hours (trace ${s.trace_id}). It keeps retrying.`],
      );
    }
    return stuck.length;
  });
}
