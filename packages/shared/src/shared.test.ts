import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RULES,
  canAccess,
  consoleChain,
  formatMoney,
  requestMessage,
  sanitizeLevels,
  totalsByCurrency,
  validateRules,
  compareVersions,
} from './index.js';

const withLimits = { ...DEFAULT_RULES, refundOpsLimitMinor: 50_000, refundCfoLimitMinor: 500_000 };

describe('approval chains', () => {
  it('always gives payroll two signers, CFO first', () => {
    expect(consoleChain({ kind: 'payroll' }, DEFAULT_RULES).map((s) => s.role)).toEqual(['cfo', 'ceo']);
  });

  it('sends every refund to the CFO until both limits are set', () => {
    expect(consoleChain({ kind: 'refund', amountMinor: 100 }, DEFAULT_RULES).map((s) => s.role)).toEqual(['cfo']);
  });

  it('routes refunds by amount once limits are set', () => {
    const chain = (amountMinor: number) => consoleChain({ kind: 'refund', amountMinor }, withLimits).map((s) => s.role);
    expect(chain(50_000)).toEqual(['ops_head']);
    expect(chain(50_001)).toEqual(['ops_head', 'cfo']);
    expect(chain(500_001)).toEqual(['ops_head', 'cfo', 'ceo']);
  });

  it('skips the CFO for the CFO’s own expense claim', () => {
    expect(consoleChain({ kind: 'expense', requesterRoleKey: 'cfo' }, DEFAULT_RULES).map((s) => s.role)).toEqual(['ceo']);
    expect(consoleChain({ kind: 'expense', requesterRoleKey: 'dept_head' }, DEFAULT_RULES).map((s) => s.role)).toEqual(['cfo']);
  });

  it('checks the rules make sense', () => {
    expect(validateRules({ ...withLimits, refundCfoLimitMinor: 50_000 })).toMatch(/higher/);
    expect(validateRules({ ...DEFAULT_RULES, escalateAfterHours: 24 })).toMatch(/after the reminder/);
    expect(validateRules(withLimits)).toBeNull();
  });
});

describe('access', () => {
  it('keeps owners-only modules for owners', () => {
    expect(canAccess({ isOwner: false, levels: { settings: 3 } }, 'settings')).toBe(false);
    expect(canAccess({ isOwner: true, levels: {} }, 'settings')).toBe(true);
    expect(sanitizeLevels({ settings: 3, approvals: 2 })).toEqual({ approvals: 2 });
  });
});

describe('money', () => {
  it('keeps totals per currency', () => {
    expect(totalsByCurrency([{ amountMinor: 100, currency: 'ETB' }, { amountMinor: 50, currency: 'USD' }, { amountMinor: 25, currency: 'ETB' }])).toEqual([
      { currency: 'ETB', amountMinor: 125 },
      { currency: 'USD', amountMinor: 50 },
    ]);
    expect(formatMoney({ amountMinor: 61200000, currency: 'ETB' })).toContain('612,000');
  });
});

describe('contract', () => {
  it('accepts a valid request message and fills defaults', () => {
    const m = requestMessage.parse({
      messageId: 'msg-00000001', system: 'hr', contractVersion: '1.0.0', sentAt: new Date().toISOString(), traceId: 'abc123', type: 'request.upsert',
      request: { externalId: 'PR-2026-10', version: 1, kind: 'payroll', title: 'Payroll · October' },
    });
    expect(m.request.facts).toEqual([]);
    expect(m.request.bulkEligible).toBe(false);
  });

  it('compares versions', () => {
    expect(compareVersions('1.2.0', '1.10.0')).toBe(-1);
  });
});
