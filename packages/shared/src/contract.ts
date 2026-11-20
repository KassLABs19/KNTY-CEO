import { z } from 'zod';
import { KIND_PATTERN } from './approvals.js';

/**
 * The contract between the Control Center and the HR system.
 * Both sides validate every message with these schemas. A breaking change ships as a new
 * major CONTRACT_VERSION, and the Control Center accepts both majors until the HR system moves.
 *
 * Every message is signed: header `x-cc-signature: t=<unix seconds>,v1=<hex HMAC-SHA256>`
 * over `${t}.${rawBody}` with the shared secret for that system. Messages older than five
 * minutes are refused. Each carries a `messageId`; repeats are ignored.
 */
export const CONTRACT_VERSION = '1.0.0';
export const SIGNATURE_HEADER = 'x-cc-signature';
export const SIGNATURE_MAX_AGE_SECONDS = 300;

const envelope = {
  messageId: z.string().min(8).max(100),
  /** The connected system. Only the HR system today; kept so more can join later. */
  system: z.literal('hr'),
  contractVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  sentAt: z.string().datetime(),
  traceId: z.string().min(4).max(64),
};

const money = z.object({
  amountMinor: z.number().int().nonnegative(),
  currency: z.string().length(3).toUpperCase(),
});

/** HR system → Control Center: a request now needs an admin-level decision, or changed. */
export const requestMessage = z.object({
  ...envelope,
  type: z.literal('request.upsert'),
  request: z.object({
    externalId: z.string().min(1).max(100),
    /** Bumps on every change in the HR system. Decisions must quote the version they saw. */
    version: z.number().int().positive(),
    /** The request type's key. An owner sets up its steps in Settings › Request types. */
    kind: z.string().regex(KIND_PATTERN),
    title: z.string().min(1).max(200),
    subtitle: z.string().max(200).default(''),
    /** The person it is from, by HR employee id, when there is one. */
    requesterEmployeeId: z.string().max(100).nullable().default(null),
    department: z.string().max(100).nullable().default(null),
    money: money.nullable().default(null),
    facts: z.array(z.object({ label: z.string().max(80), value: z.string().max(300) })).max(20).default([]),
    /** References to values the Control Center may fetch on demand (never sent in the message). */
    masked: z.array(z.object({ field: z.enum(['salary']), ref: z.string().max(200) })).max(5).default([]),
    /** The HR system's own checks passed, so the request may be approved in bulk (if its type allows it). */
    bulkEligible: z.boolean().default(false),
    /** Steps already completed in the HR system, shown read-only. */
    partnerSteps: z.array(z.object({ label: z.string().max(120), by: z.string().max(120), at: z.string().datetime() })).max(10).default([]),
  }),
});
export type RequestMessage = z.infer<typeof requestMessage>;

/** HR system → Control Center: the request was withdrawn or closed upstream. */
export const cancelMessage = z.object({
  ...envelope,
  type: z.literal('request.cancel'),
  externalId: z.string().min(1).max(100),
  version: z.number().int().positive(),
  reason: z.string().max(300).default(''),
});
export type CancelMessage = z.infer<typeof cancelMessage>;

/** HR system → Control Center: joiner, mover or leaver. The HR system owns people. */
export const peopleMessage = z.object({
  ...envelope,
  type: z.literal('people.event'),
  event: z.enum(['joiner', 'mover', 'leaver', 'details']),
  employee: z.object({
    employeeId: z.string().min(1).max(100),
    fullName: z.string().min(1).max(200),
    email: z.string().email().max(254),
    department: z.string().max(100).nullable(),
    jobTitle: z.string().max(120).nullable(),
    /** For leavers: the exit date. For movers: the date the change takes effect. */
    effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    /** True when the job title changed, which asks an owner to review the role. */
    titleChanged: z.boolean().default(false),
  }),
});
export type PeopleMessage = z.infer<typeof peopleMessage>;

export const inboundMessage = z.discriminatedUnion('type', [requestMessage, cancelMessage, peopleMessage]);
export type InboundMessage = z.infer<typeof inboundMessage>;

/** Control Center → HR system: the final decision on a request. */
export const decisionMessage = z.object({
  messageId: z.string(),
  contractVersion: z.string(),
  sentAt: z.string().datetime(),
  traceId: z.string(),
  type: z.literal('request.decision'),
  externalId: z.string(),
  /** The HR system must refuse a decision for a version that is no longer current. */
  version: z.number().int().positive(),
  decision: z.enum(['approved', 'rejected', 'returned']),
  note: z.string().max(1000).nullable(),
  decidedBy: z.object({ name: z.string(), role: z.string() }),
  onBehalfOf: z.object({ name: z.string(), role: z.string() }).nullable(),
});
export type DecisionMessage = z.infer<typeof decisionMessage>;

/** Major version of a "x.y.z" string. */
export function contractMajor(v: string): number {
  return Number.parseInt(v.split('.')[0] ?? '0', 10);
}

/** The majors this build accepts. */
export const ACCEPTED_MAJORS = [contractMajor(CONTRACT_VERSION)];
