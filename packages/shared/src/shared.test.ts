import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REQUEST_TYPES,
  DEFAULT_RULES,
  canAccess,
  compareVersions,
  formatMoney,
  requestMessage,
  sanitizeLevels,
  stepsFor,
  totalsByCurrency,
  validateRequestType,
  validateRules,
  type RequestTypeConfig,
} from './index.js';

const type = (steps: RequestTypeConfig['steps'], extra: Partial<RequestTypeConfig> = {}): RequestTypeConfig => ({
  key: 'purchase', name: 'Something with amounts', module: 'finance', active: true, steps,
  reauth: false, delegable: true, bulkAllowed: false, lockWhenApproved: false, ...extra,
});

describe('request types', () => {
  it('ships payroll with two signers, never delegated, locked once approved', () => {
    const payroll = DEFAULT_REQUEST_TYPES.find((t) => t.key === 'payroll')!;
    expect(payroll.steps.map((s) => s.role)).toEqual(['cfo', 'ceo']);
    expect(payroll).toMatchObject({ delegable: false, reauth: true, lockWhenApproved: true });
  });

  it('adds steps only above their amount', () => {
    const t = type([
      { roleId: 'ops', label: 'Ops', aboveMinor: null },
      { roleId: 'cfo', label: 'CFO', aboveMinor: 50_000 },
      { roleId: 'ceo', label: 'CEO', aboveMinor: 500_000 },
    ]);
    expect(stepsFor(t, 50_000).map((s) => s.roleId)).toEqual(['ops']);
    expect(stepsFor(t, 50_001).map((s) => s.roleId)).toEqual(['ops', 'cfo']);
    expect(stepsFor(t, 500_001).map((s) => s.roleId)).toEqual(['ops', 'cfo', 'ceo']);
    expect(stepsFor(t, null).map((s) => s.roleId)).toEqual(['ops']);
  });

  it('checks a request type before saving', () => {
    const ok = type([{ roleId: 'r1', label: 'CFO', aboveMinor: null }]);
    expect(validateRequestType(ok, ['r1'])).toBeNull();
    expect(validateRequestType({ ...ok, key: 'Bad Key' }, ['r1'])).toMatch(/key/);
    expect(validateRequestType({ ...ok, steps: [] }, ['r1'])).toMatch(/at least one step/);
    expect(validateRequestType({ ...ok, steps: [] , active: false }, ['r1'])).toBeNull();
    expect(validateRequestType(ok, ['other'])).toMatch(/role/);
    expect(validateRequestType(type([{ roleId: 'r1', label: 'CFO', aboveMinor: 100 }]), ['r1'])).toMatch(/every amount/);
  });

  it('checks the reminder rules', () => {
    expect(validateRules({ ...DEFAULT_RULES, escalateAfterHours: 24 })).toMatch(/after the reminder/);
    expect(validateRules(DEFAULT_RULES)).toBeNull();
  });
});

describe('access', () => {
  it('keeps owners-only areas for owners', () => {
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
  it('accepts any well-formed request type key from the HR system', () => {
    const base = { messageId: 'msg-00000001', system: 'hr', contractVersion: '1.0.0', sentAt: new Date().toISOString(), traceId: 'abc123', type: 'request.upsert' };
    const m = requestMessage.parse({ ...base, request: { externalId: 'TR-1', version: 1, kind: 'training_budget', title: 'Training budget' } });
    expect(m.request.facts).toEqual([]);
    expect(() => requestMessage.parse({ ...base, system: 'other', request: { externalId: 'X', version: 1, kind: 'leave', title: 'x' } })).toThrow();
    expect(() => requestMessage.parse({ ...base, request: { externalId: 'X', version: 1, kind: 'Not OK', title: 'x' } })).toThrow();
  });

  it('compares versions', () => {
    expect(compareVersions('1.2.0', '1.10.0')).toBe(-1);
  });
});
