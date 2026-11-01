import type { RoleKey } from './roles.js';

/**
 * Approval chains.
 *
 * Every request starts in a partner system (HR system or Predicto). The partner owns
 * and runs the steps before a fixed hand-off point; the Control Center owns every step
 * after it. Neither side can configure the other's steps, so the two can't disagree.
 */

export const SYSTEMS = ['hr', 'predicto'] as const;
export type PartnerSystem = (typeof SYSTEMS)[number];

export const REQUEST_KINDS = ['leave', 'payroll', 'hire', 'expense', 'refund', 'manual_payment'] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];

export const KIND_SYSTEM: Record<RequestKind, PartnerSystem> = {
  leave: 'hr',
  payroll: 'hr',
  hire: 'hr',
  expense: 'hr',
  refund: 'predicto',
  manual_payment: 'predicto',
};

export type RequestStatus = 'pending' | 'approved' | 'rejected' | 'returned' | 'cancelled';
export type StepState = 'done' | 'now' | 'later' | 'rejected' | 'returned';
export type Decision = 'approve' | 'reject' | 'send_back';

export interface ApprovalRules {
  /** Head of Ops may approve refunds alone up to this amount (minor units). Null = not set. */
  refundOpsLimitMinor: number | null;
  /** The CFO may approve refunds alone up to this amount (minor units). Null = not set. */
  refundCfoLimitMinor: number | null;
  /** Department heads' leave goes to the CEO after the Head of HR. */
  deptHeadLeaveToCeo: boolean;
  /** Remind the approver after this many hours. */
  remindAfterHours: number;
  /** Also give the step to the delegate, or the next approver, after this many hours. */
  escalateAfterHours: number;
  /** Request kinds whose approval needs the password entered again. */
  reauthFor: RequestKind[];
}

export const DEFAULT_RULES: ApprovalRules = {
  refundOpsLimitMinor: null,
  refundCfoLimitMinor: null,
  deptHeadLeaveToCeo: true,
  remindAfterHours: 24,
  escalateAfterHours: 48,
  reauthFor: ['payroll'],
};

export interface ChainStepPlan {
  role: RoleKey;
  label: string;
}

export interface ChainInput {
  kind: RequestKind;
  amountMinor?: number | null;
  /** Role of the person the request is for or from, when they have a Control Center login. */
  requesterRoleKey?: RoleKey | null;
}

/**
 * The Control Center's steps for one request, in order. The partner's own steps are
 * already done by the time a request arrives and are not included here.
 */
export function consoleChain(input: ChainInput, rules: ApprovalRules): ChainStepPlan[] {
  switch (input.kind) {
    case 'payroll':
      // Always two different signers, CFO first.
      return [
        { role: 'cfo', label: 'CFO · signer 1 of 2' },
        { role: 'ceo', label: 'CEO · signer 2 of 2' },
      ];
    case 'hire':
      return [
        { role: 'cfo', label: 'CFO' },
        { role: 'ceo', label: 'CEO' },
      ];
    case 'expense':
      // A CFO's own claim skips to the CEO: nobody approves their own request.
      return input.requesterRoleKey === 'cfo' ? [{ role: 'ceo', label: 'CEO' }] : [{ role: 'cfo', label: 'CFO' }];
    case 'leave':
      return rules.deptHeadLeaveToCeo ? [{ role: 'ceo', label: 'CEO' }] : [];
    case 'manual_payment':
      return [{ role: 'ops_head', label: 'Head of Operations' }];
    case 'refund': {
      const amount = input.amountMinor ?? 0;
      const ops = rules.refundOpsLimitMinor;
      const cfo = rules.refundCfoLimitMinor;
      // Until both limits are set, every refund goes to the CFO.
      if (ops === null || cfo === null) return [{ role: 'cfo', label: 'CFO' }];
      if (amount <= ops) return [{ role: 'ops_head', label: 'Head of Operations' }];
      if (amount <= cfo) return [{ role: 'ops_head', label: 'Head of Operations' }, { role: 'cfo', label: 'CFO' }];
      return [
        { role: 'ops_head', label: 'Head of Operations' },
        { role: 'cfo', label: 'CFO' },
        { role: 'ceo', label: 'CEO' },
      ];
    }
  }
}

/** The partner-owned steps for each kind, shown read-only in the Control Center. */
export const PARTNER_STEPS: Record<RequestKind, string> = {
  leave: 'Head of HR (in the HR system)',
  payroll: 'HR officer prepares and freezes (in the HR system)',
  hire: 'Department head, Head of HR (in the HR system)',
  expense: 'Finance checks receipts (in the HR system)',
  refund: 'Rule check before the first deadline (in Predicto)',
  manual_payment: 'Reference and phone checks (in Predicto)',
};

/** Kinds that may be approved in bulk, and only when the partner marked them as checked. */
export const BULK_KINDS: readonly RequestKind[] = ['manual_payment'];

/** Kinds that can never be handed to a delegate. */
export const NEVER_DELEGATED: readonly RequestKind[] = ['payroll'];

export function validateRules(r: ApprovalRules): string | null {
  if (r.refundOpsLimitMinor !== null && r.refundCfoLimitMinor !== null && r.refundCfoLimitMinor <= r.refundOpsLimitMinor) {
    return 'The CFO’s refund limit must be higher than the Head of Operations’ limit.';
  }
  if (r.escalateAfterHours <= r.remindAfterHours) return 'Escalation must come after the reminder.';
  if (r.remindAfterHours < 1) return 'The reminder must be at least 1 hour.';
  return null;
}
