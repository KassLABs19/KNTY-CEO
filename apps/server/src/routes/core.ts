import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  CONTRACT_VERSION,
  DEFAULT_RULES,
  REQUEST_KINDS,
  isVersionSupported,
  totalsByCurrency,
  validateRules,
  type Me,
  type OverviewData,
  type SettingsData,
  type SystemStatus,
  type VersionInfo,
} from '@ceo/shared';
import { SERVER_VERSION, type Config } from '../config.js';
import { withCompany, type Db } from '../db.js';
import { requireAuth } from '../guard.js';
import { audit } from '../audit.js';
import { reauthValid } from '../auth/tokens.js';
import { canSee, loadRules, loadSteps, type RequestRow } from '../approvals.js';
import { AppError } from '../errors.js';
import { summarize } from '../views.js';
import type { LicenceState } from '../licence.js';

const rulesBody = z.object({
  refundOpsLimitMinor: z.number().int().nonnegative().nullable(),
  refundCfoLimitMinor: z.number().int().nonnegative().nullable(),
  deptHeadLeaveToCeo: z.boolean(),
  remindAfterHours: z.number().int().min(1).max(720),
  escalateAfterHours: z.number().int().min(2).max(1440),
  reauthFor: z.array(z.enum(REQUEST_KINDS)).refine((k) => k.includes('payroll'), 'Payroll always needs the password again.'),
});

/** Quotes a CSV cell, and stops spreadsheet apps from running text that starts like a formula. */
const csvCell = (v: unknown) => {
  const s = String(v ?? '');
  return `"${(/^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
};

export function registerCoreRoutes(app: FastifyInstance, db: Db, config: Config, licence: () => LicenceState) {
  const auth = (need?: Parameters<typeof requireAuth>[2]) => requireAuth(db, config.JWT_SECRET, need);

  app.get('/health', async () => {
    await db.query('SELECT 1');
    return { status: 'ok', version: SERVER_VERSION, env: config.APP_ENV, mode: config.HOSTING_MODE, licence: licence().status };
  });

  app.get('/api/version', async (req) => {
    const q = req.query as { v?: string };
    const info: VersionInfo & { env: string } = {
      serverVersion: SERVER_VERSION,
      minDesktopVersion: config.MIN_DESKTOP_VERSION,
      supported: q.v ? isVersionSupported(q.v, config.MIN_DESKTOP_VERSION) : true,
      hostingMode: config.HOSTING_MODE,
      contractVersion: CONTRACT_VERSION,
      env: config.APP_ENV,
    };
    return info;
  });

  app.get('/api/me', { preHandler: auth() }, async (req) => {
    const u = req.user!;
    return withCompany(db, u.companyId, async (tx) => {
      const row = (await tx.query<{ email: string; company_name: string }>(
        'SELECT u.email, c.name AS company_name FROM users u JOIN companies c ON c.id = u.company_id WHERE u.id = $1',
        [u.id],
      )).rows[0]!;
      const me: Me = {
        id: u.id,
        fullName: u.fullName,
        email: row.email,
        department: u.department,
        isOwner: u.isOwner,
        company: { id: u.companyId, name: row.company_name },
        role: u.role,
      };
      return me;
    });
  });

  app.get('/api/overview', { preHandler: auth({ module: 'overview' }) }, async (req) => {
    const u = req.user!;
    return withCompany(db, u.companyId, async (tx) => {
      const rules = await loadRules(tx);
      const open = (await tx.query<RequestRow>(`SELECT * FROM requests WHERE status = 'pending' ORDER BY step_started_at LIMIT 500`)).rows;
      const visible = [];
      for (const r of open) {
        const steps = await loadSteps(tx, r.id);
        if (await canSee(tx, u, r, steps)) visible.push(await summarize(tx, u, r, steps, rules.remindAfterHours));
      }
      const decidedThisWeek = (await tx.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM request_steps WHERE decided_by = $1 AND decided_at > now() - interval '7 days'`,
        [u.id],
      )).rows[0]!.n;
      const partners = (await tx.query<{ system: 'hr' | 'predicto'; name: string; base_url: string | null; last_message_at: Date | null; contract_version: string | null; waiting: number; oldest: number | null }>(
        `SELECT p.system, p.name, p.base_url, p.last_message_at, p.contract_version,
                (SELECT count(*)::int FROM outbox o WHERE o.system = p.system AND o.delivered_at IS NULL) AS waiting,
                (SELECT floor(extract(epoch FROM now() - min(o.created_at)) / 60)::int FROM outbox o WHERE o.system = p.system AND o.delivered_at IS NULL) AS oldest
           FROM partners p ORDER BY p.system`,
      )).rows;
      const systems: SystemStatus[] = partners.map((p) => ({
        system: p.system,
        name: p.name,
        connected: Boolean(p.base_url),
        lastMessageAt: p.last_message_at?.toISOString() ?? null,
        outboxWaiting: p.waiting,
        oldestWaitingMinutes: p.oldest,
        contractVersion: p.contract_version,
      }));
      const data: OverviewData = {
        waiting: visible.filter((s) => s.yourTurn).slice(0, 8),
        counts: { waitingOnYou: visible.filter((s) => s.yourTurn).length, overdue: visible.filter((s) => s.overdue).length, openTotal: visible.length, decidedThisWeek },
        pendingByCurrency: totalsByCurrency(visible.flatMap((s) => (s.money ? [s.money] : []))),
        systems,
      };
      return data;
    });
  });

  app.get('/api/notifications', { preHandler: auth() }, async (req) => {
    const u = req.user!;
    return withCompany(db, u.companyId, async (tx) =>
      (await tx.query(
        `SELECT id, kind, text, request_id AS "requestId", created_at AS "createdAt", read_at IS NOT NULL AS read
           FROM notifications WHERE user_id = $1 ORDER BY id DESC LIMIT 50`,
        [u.id],
      )).rows,
    );
  });

  app.post('/api/notifications/read', { preHandler: auth() }, async (req, reply) => {
    const u = req.user!;
    await withCompany(db, u.companyId, (tx) => tx.query('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL', [u.id]));
    return reply.status(204).send();
  });

  app.get('/api/roles', { preHandler: auth() }, async (req) =>
    withCompany(db, req.user!.companyId, async (tx) =>
      (await tx.query(
        `SELECT r.id, r.key, r.name, r.scope, r.requires_2fa AS "requires2fa", r.levels, r.is_system AS "isSystem",
                (SELECT count(*)::int FROM users u WHERE u.role_id = r.id AND u.status <> 'suspended') AS members
           FROM roles r ORDER BY r.is_system DESC, r.name`,
      )).rows,
    ),
  );

  app.get('/api/settings', { preHandler: auth() }, async (req) =>
    withCompany(db, req.user!.companyId, async (tx) => {
      const row = (await tx.query<{ locale: SettingsData['locale'] }>('SELECT locale FROM settings')).rows[0];
      const data: SettingsData = { rules: await loadRules(tx), locale: row?.locale ?? { numberLocale: 'en-GB', dateStyle: 'medium', timeZone: 'UTC' } };
      return data;
    }),
  );

  // Changing approval rules needs an owner who just typed their password again.
  app.put('/api/settings/rules', { preHandler: auth({ module: 'settings' }) }, async (req) => {
    const u = req.user!;
    if (!(await reauthValid(req.headers['x-reauth-token'] as string | undefined, u.id, u.sessionId, config.JWT_SECRET))) {
      throw new AppError(401, 'reauth_required', 'Enter your password again to change approval rules.');
    }
    const parsed = rulesBody.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, 'invalid_rules', parsed.error.issues[0]?.message ?? 'These rules are not valid.');
    const problem = validateRules(parsed.data);
    if (problem) throw new AppError(400, 'invalid_rules', problem);
    return withCompany(db, u.companyId, async (tx) => {
      const before = await loadRules(tx);
      await tx.query(
        `INSERT INTO settings (company_id, rules, updated_by, updated_at) VALUES ($1, $2, $3, now())
         ON CONFLICT (company_id) DO UPDATE SET rules = EXCLUDED.rules, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [u.companyId, JSON.stringify(parsed.data), u.id],
      );
      await audit(tx, { companyId: u.companyId, actorUserId: u.id, action: 'settings.rules_changed', category: 'settings', ip: req.ip, detail: { before, after: parsed.data } });
      return { ...DEFAULT_RULES, ...parsed.data };
    });
  });

  // Where to deliver decisions for each partner system. Owners only, password again.
  app.put('/api/partners/:system', { preHandler: auth({ module: 'settings' }) }, async (req) => {
    const u = req.user!;
    if (!(await reauthValid(req.headers['x-reauth-token'] as string | undefined, u.id, u.sessionId, config.JWT_SECRET))) {
      throw new AppError(401, 'reauth_required', 'Enter your password again to change a partner address.');
    }
    const { system } = z.object({ system: z.enum(['hr', 'predicto']) }).parse(req.params);
    const body = z.object({ baseUrl: z.string().url().max(300) }).safeParse(req.body);
    if (!body.success) throw new AppError(400, 'invalid_url', 'Enter the full address, starting with https://');
    const url = new URL(body.data.baseUrl);
    if (url.protocol !== 'https:' && config.APP_ENV === 'production') throw new AppError(400, 'https_required', 'Partner addresses must use https:// in production.');
    return withCompany(db, u.companyId, async (tx) => {
      await tx.query('UPDATE partners SET base_url = $2 WHERE system = $1', [system, url.origin + url.pathname.replace(/\/+$/, '')]);
      await audit(tx, { companyId: u.companyId, actorUserId: u.id, action: 'settings.partner_address', category: 'settings', targetType: 'partner', targetId: system, ip: req.ip, detail: { baseUrl: url.origin } });
      return { system, baseUrl: url.origin + url.pathname.replace(/\/+$/, '') };
    });
  });

  const auditQuery = z.object({
    category: z.enum(['approvals', 'access', 'logins', 'security', 'sensitive', 'sync', 'settings', 'other']).optional(),
    before: z.coerce.number().int().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  });
  const auditSql = `SELECT a.id, a.created_at AS "createdAt", a.action, a.category, a.target_type AS "targetType", a.target_id AS "targetId",
       a.trace_id AS "traceId", a.detail, coalesce(pa.full_name, 'System') AS actor, pb.full_name AS "onBehalfOf"
     FROM audit_log a
     LEFT JOIN users ua ON ua.id = a.actor_user_id LEFT JOIN people pa ON pa.id = ua.person_id
     LEFT JOIN users ub ON ub.id = a.on_behalf_of LEFT JOIN people pb ON pb.id = ub.person_id
    WHERE ($1::text IS NULL OR a.category = $1) AND ($2::bigint IS NULL OR a.id < $2)
    ORDER BY a.id DESC LIMIT $3`;

  app.get('/api/audit', { preHandler: auth({ module: 'audit' }) }, async (req) => {
    const q = auditQuery.parse(req.query);
    return withCompany(db, req.user!.companyId, async (tx) => (await tx.query(auditSql, [q.category ?? null, q.before ?? null, q.limit])).rows);
  });

  // CSV export: every file names who downloaded it and when, and the download itself is logged.
  app.get('/api/audit/export', { preHandler: auth({ module: 'audit' }) }, async (req, reply) => {
    const q = auditQuery.parse({ ...(req.query as object), limit: 200 });
    const u = req.user!;
    const csv = await withCompany(db, u.companyId, async (tx) => {
      const rows = (await tx.query(auditSql.replace('LIMIT $3', 'LIMIT 10000'), [q.category ?? null, q.before ?? null])).rows;
      await audit(tx, { companyId: u.companyId, actorUserId: u.id, action: 'audit.exported', category: 'sensitive', ip: req.ip, detail: { rows: rows.length, category: q.category ?? 'all' } });
      const lines = [
        csvCell(`Exported by ${u.fullName} (${u.role.name}) on ${new Date().toISOString()}. Confidential.`),
        ['When', 'Who', 'On behalf of', 'Action', 'Category', 'Target', 'Trace'].map(csvCell).join(','),
        ...rows.map((r) => [r.createdAt.toISOString(), r.actor, r.onBehalfOf, r.action, r.category, `${r.targetType ?? ''} ${r.targetId ?? ''}`.trim(), r.traceId].map(csvCell).join(',')),
      ];
      return lines.join('\r\n');
    });
    // Sent only after the export is logged.
    return reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="audit-log.csv"').send(csv);
  });
}
