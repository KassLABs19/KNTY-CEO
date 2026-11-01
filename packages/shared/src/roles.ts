/**
 * Roles and access for the Control Center.
 *
 * Access is a matrix: for each module a role has a level (none, view, approve, manage).
 * Which people and requests a role sees is set by its `scope`. The CEO assigns roles.
 *
 * Three modules are for account owners only (the CEO and a backup owner): logins,
 * access and settings. No other role can be given them, whatever the matrix says.
 */

export const MODULES = [
  // Control Center
  'overview',
  'approvals',
  'finance',
  'audit',
  'settings',
  'logins',
  'access',
  // From the HR system
  'people',
  'leave',
  'payroll',
  // From Predicto
  'predicto',
  'refunds',
] as const;
export type Module = (typeof MODULES)[number];

export const OWNERS_ONLY_MODULES: readonly Module[] = ['settings', 'logins', 'access'];

export const MODULE_GROUPS: { system: 'cc' | 'hr' | 'predicto'; label: string; modules: Module[] }[] = [
  { system: 'cc', label: 'Control Center', modules: ['overview', 'approvals', 'finance', 'audit', 'settings', 'logins', 'access'] },
  { system: 'hr', label: 'HR system', modules: ['people', 'leave', 'payroll'] },
  { system: 'predicto', label: 'Predicto', modules: ['predicto', 'refunds'] },
];

/** 0 none · 1 view · 2 approve (at their step) · 3 manage */
export const LEVELS = ['none', 'view', 'approve', 'manage'] as const;
export type Level = 0 | 1 | 2 | 3;
export type Levels = Partial<Record<Module, Level>>;

export const SCOPES = ['company', 'department', 'team'] as const;
export type Scope = (typeof SCOPES)[number];

/** Stable keys for the built-in roles. Approval chains point at these. */
export const ROLE_KEYS = ['ceo', 'cfo', 'hr_head', 'ops_head', 'dept_head', 'admin'] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

export interface RoleDefinition {
  key: RoleKey;
  name: string;
  scope: Scope;
  requires2fa: boolean;
  levels: Levels;
}

const every = (level: Level): Levels => Object.fromEntries(MODULES.map((m) => [m, level])) as Levels;

/** The roles every new company starts with. Owners can change levels and add custom roles. */
export const SYSTEM_ROLES: RoleDefinition[] = [
  { key: 'ceo', name: 'CEO', scope: 'company', requires2fa: true, levels: every(3) },
  {
    key: 'cfo', name: 'CFO', scope: 'company', requires2fa: true,
    levels: { overview: 1, approvals: 2, finance: 3, audit: 1, people: 1, payroll: 2, predicto: 1, refunds: 2 },
  },
  {
    key: 'hr_head', name: 'Head of HR', scope: 'company', requires2fa: false,
    levels: { overview: 1, approvals: 2, audit: 1, people: 3, leave: 2, payroll: 1 },
  },
  {
    key: 'ops_head', name: 'Head of Operations', scope: 'company', requires2fa: false,
    levels: { overview: 1, approvals: 2, people: 1, predicto: 3, refunds: 2 },
  },
  {
    key: 'dept_head', name: 'Department head', scope: 'department', requires2fa: false,
    levels: { overview: 1, approvals: 2, finance: 1, people: 1, leave: 2 },
  },
  {
    key: 'admin', name: 'Admin', scope: 'company', requires2fa: false,
    levels: { overview: 1, approvals: 2, leave: 1, predicto: 2 },
  },
];

export function levelOf(levels: Levels, module: Module): Level {
  return levels[module] ?? 0;
}

/** True when the role may open the module at `min` or above. Owners-only modules need an owner. */
export function canAccess(user: { isOwner: boolean; levels: Levels }, module: Module, min: Level = 1): boolean {
  if (OWNERS_ONLY_MODULES.includes(module)) return user.isOwner;
  return user.isOwner || levelOf(user.levels, module) >= min;
}

/** Strips owners-only modules from a role's levels before saving: only owners hold them. */
export function sanitizeLevels(levels: Levels): Levels {
  const out: Levels = {};
  for (const m of MODULES) {
    const v = levels[m];
    if (v === undefined || OWNERS_ONLY_MODULES.includes(m)) continue;
    if (v === 0 || v === 1 || v === 2 || v === 3) out[m] = v;
  }
  return out;
}
