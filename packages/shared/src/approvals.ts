import { MODULES, type Module, type RoleKey } from './roles.js';

/**
 * Approval chains are configured per request type, not written into the code.
 *
 * The HR system runs its own steps for a request, up to a fixed hand-off point, and then
 * sends it here. From there the Control Center runs the steps the account owners set for
 * that request type in Settings. New request types can be added without changing code:
 * the HR system starts sending a new `kind`, and an owner sets up its steps.
 */

export type RequestStatus = 'pending' | 'approved' | 'rejected' | 'returned' | 'cancelled';
export type StepState = 'done' | 'now' | 'later' | 'rejected' | 'returned';
export type Decision = 'approve' | 'reject' | 'send_back';

/** A request type's key, as the HR system sends it: lower case letters, digits and _. */
export const KIND_PATTERN = /^[a-z][a-z0-9_]{1,39}$/;

export interface StepConfig {
  /** The role that decides this step. */
  roleId: string;
  /** Shown in the chain, for example "CFO · signer 1 of 2". */
  label: string;
  /** Only include this step when the amount is above this (minor units). Null: always. */
  aboveMinor: number | null;
}

export interface RequestTypeConfig {
  key: string;
  name: string;
  /** The access-matrix area that decides who can see these requests. */
  module: Module;
  /** Off: requests of this type are refused until an owner turns it on. */
  active: boolean;
  steps: StepConfig[];
  /** Approving needs the password entered again. */
  reauth: boolean;
  /** Steps may be handled by a delegate while the approver is away. */
  delegable: boolean;
  /** Requests the HR system marks as checked may be approved several at a time. */
  bulkAllowed: boolean;
  /** Lock the request once approved; any change must come back as a new version. */
  lockWhenApproved: boolean;
}

export interface ApprovalRules {
  /** Remind the approver after this many hours. */
  remindAfterHours: number;
  /** Also tell their delegate, or the next approver, after this many hours. */
  escalateAfterHours: number;
}

export const DEFAULT_RULES: ApprovalRules = { remindAfterHours: 24, escalateAfterHours: 48 };

/** The steps that apply to one request, given its amount. */
export function stepsFor(type: Pick<RequestTypeConfig, 'steps'>, amountMinor: number | null | undefined): StepConfig[] {
  return type.steps.filter((s) => s.aboveMinor === null || (amountMinor ?? 0) > s.aboveMinor);
}

/**
 * Starting request types for a new company, written with role keys; setup turns the keys
 * into the company's role ids. Owners can change all of them.
 */
export const DEFAULT_REQUEST_TYPES: (Omit<RequestTypeConfig, 'steps'> & { steps: { role: RoleKey; label: string; aboveMinor: number | null }[] })[] = [
  {
    key: 'leave', name: 'Leave (department heads)', module: 'leave', active: true,
    steps: [{ role: 'ceo', label: 'CEO', aboveMinor: null }],
    reauth: false, delegable: true, bulkAllowed: false, lockWhenApproved: false,
  },
  {
    key: 'payroll', name: 'Payroll run', module: 'payroll', active: true,
    steps: [
      { role: 'cfo', label: 'CFO · signer 1 of 2', aboveMinor: null },
      { role: 'ceo', label: 'CEO · signer 2 of 2', aboveMinor: null },
    ],
    reauth: true, delegable: false, bulkAllowed: false, lockWhenApproved: true,
  },
  {
    key: 'hire', name: 'New hire', module: 'people', active: true,
    steps: [{ role: 'cfo', label: 'CFO', aboveMinor: null }, { role: 'ceo', label: 'CEO', aboveMinor: null }],
    reauth: false, delegable: true, bulkAllowed: false, lockWhenApproved: false,
  },
  {
    key: 'expense', name: 'Expense claim', module: 'finance', active: true,
    steps: [{ role: 'cfo', label: 'CFO', aboveMinor: null }],
    reauth: false, delegable: true, bulkAllowed: false, lockWhenApproved: false,
  },
];

/** Checks one request type before it is saved. Returns a message, or null when it's fine. */
export function validateRequestType(t: RequestTypeConfig, roleIds: string[]): string | null {
  if (!KIND_PATTERN.test(t.key)) return 'The key must start with a letter and use only lower case letters, digits and _.';
  if (!t.name.trim()) return 'Give the request type a name.';
  if (!MODULES.includes(t.module)) return 'Choose which area these requests belong to.';
  if (t.active && t.steps.length === 0) return 'An active request type needs at least one step.';
  if (t.steps.length > 8) return 'Use at most 8 steps.';
  for (const s of t.steps) {
    if (!roleIds.includes(s.roleId)) return 'Every step needs a role that exists.';
    if (!s.label.trim()) return 'Give every step a label.';
    if (s.aboveMinor !== null && (!Number.isInteger(s.aboveMinor) || s.aboveMinor < 0)) return 'Amounts must be whole numbers of zero or more.';
  }
  if (t.steps.length > 0 && t.steps.every((s) => s.aboveMinor !== null)) return 'At least one step must apply to every amount, or small requests would have no steps.';
  return null;
}

export function validateRules(r: ApprovalRules): string | null {
  if (r.remindAfterHours < 1) return 'The reminder must be at least 1 hour.';
  if (r.escalateAfterHours <= r.remindAfterHours) return 'Escalation must come after the reminder.';
  return null;
}

