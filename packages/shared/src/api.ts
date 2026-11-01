import type { Decision, PartnerSystem, RequestKind, RequestStatus, StepState, ApprovalRules } from './approvals.js';
import type { Money } from './money.js';
import type { Levels, RoleKey, Scope } from './roles.js';

/** Request and response shapes shared by the server and the desktop app. */

export interface LoginRequest {
  email: string;
  password: string;
  appVersion: string;
}

export type LoginResponse =
  | { step: 'done'; session: SessionTokens }
  | { step: '2fa'; challengeToken: string }
  | { step: '2fa-setup'; challengeToken: string; otpauthUrl: string; secret: string };

export interface TwoFactorRequest {
  challengeToken: string;
  code: string;
}

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

/** A short-lived proof that the person just typed their password again. */
export interface ReauthResponse {
  reauthToken: string;
  expiresIn: number;
}

export interface Me {
  id: string;
  fullName: string;
  email: string;
  department: string | null;
  isOwner: boolean;
  company: { id: string; name: string };
  role: { id: string; key: RoleKey | null; name: string; scope: Scope; levels: Levels };
}

export interface ApiError {
  error: string;
  message: string;
}

export interface VersionInfo {
  serverVersion: string;
  minDesktopVersion: string;
  supported: boolean;
  hostingMode: 'cloud' | 'self';
  contractVersion: string;
}

export interface InviteInfo {
  fullName: string;
  email: string;
  roleName: string;
  requires2fa: boolean;
}

export interface RequestSummary {
  id: string;
  ref: string;
  system: PartnerSystem;
  kind: RequestKind;
  title: string;
  subtitle: string;
  money: Money | null;
  status: RequestStatus;
  version: number;
  ageHours: number;
  overdue: boolean;
  /** The partner changed it after it reached the current step. */
  changedUpstream: boolean;
  yourTurn: boolean;
  onBehalfOf: string | null;
  bulkEligible: boolean;
}

export interface ChainStepView {
  label: string;
  owner: 'partner' | 'console';
  state: StepState;
  decidedBy: string | null;
  onBehalfOf: string | null;
  decidedAt: string | null;
  note: string | null;
}

export interface RequestDetail extends RequestSummary {
  traceId: string;
  facts: { label: string; value: string }[];
  hasMaskedSalary: boolean;
  chain: ChainStepView[];
  /** Why the signed-in person can't decide right now, if they can't. */
  blockedReason: string | null;
  needsReauth: boolean;
  events: { at: string; who: string; what: string }[];
}

export interface DecideRequest {
  decision: Decision;
  /** The version the person was looking at. A newer version means the decision is refused. */
  version: number;
  note?: string;
}

export interface OverviewData {
  waiting: RequestSummary[];
  counts: { waitingOnYou: number; overdue: number; openTotal: number; decidedThisWeek: number };
  /** Pending money per currency; never converted. */
  pendingByCurrency: Money[];
  systems: SystemStatus[];
}

export interface SystemStatus {
  system: PartnerSystem;
  name: string;
  connected: boolean;
  lastMessageAt: string | null;
  outboxWaiting: number;
  oldestWaitingMinutes: number | null;
  contractVersion: string | null;
}

export interface PersonRow {
  id: string;
  userId: string | null;
  lastSignInAt: string | null;
  locked: boolean;
  twoStepRequired: boolean | null;
  inviteExpiresAt: string | null;
  employeeId: string;
  fullName: string;
  email: string;
  department: string | null;
  jobTitle: string | null;
  roleId: string | null;
  roleName: string | null;
  login: 'none' | 'invited' | 'active' | 'suspended';
  isOwner: boolean;
  needsRoleReview: boolean;
  leftOn: string | null;
  twoStep: boolean;
}

export interface PeopleChange {
  id: number;
  at: string;
  event: 'joiner' | 'mover' | 'leaver';
  name: string;
  employeeId: string;
  department: string | null;
  jobTitle: string | null;
  needsRoleReview: boolean | null;
  leftOn: string | null;
  login: 'invited' | 'active' | 'suspended' | 'removed' | null;
}

export interface RoleSummary {
  id: string;
  key: string | null;
  name: string;
  scope: string;
  requires2fa: boolean;
  members: number;
}

export interface InviteCreated {
  inviteToken: string;
  inviteLink: string;
  expiresAt: string;
}

export interface SettingsData {
  rules: ApprovalRules;
  locale: { numberLocale: string; dateStyle: 'medium' | 'short' | 'iso'; timeZone: string };
}

export type { ApprovalRules };
