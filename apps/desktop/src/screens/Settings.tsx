import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  ApiRequestError,
  KIND_PATTERN,
  OWNERS_ONLY_MODULES,
  MODULES,
  validateRequestType,
  validateRules,
  type ApprovalRules,
  type Me,
  type Module,
  type RequestTypeConfig,
  type RoleSummary,
  type SettingsData,
  type StepConfig,
} from '@ceo/shared';
import { api } from '../api';
import { useReauth } from './dialogs';

const AREA: Record<Module, string> = {
  overview: 'Overview', approvals: 'Approvals', finance: 'Finance', audit: 'Audit log', settings: 'Settings',
  logins: 'Logins', access: 'Access', people: 'People', leave: 'Leave', payroll: 'Payroll',
};
const AREAS = MODULES.filter((m) => !OWNERS_ONLY_MODULES.includes(m) && m !== 'overview' && m !== 'approvals' && m !== 'audit');

const blankType = (): RequestTypeConfig => ({
  key: '', name: '', module: 'finance', active: true, steps: [],
  reauth: false, delegable: true, bulkAllowed: false, lockWhenApproved: false,
});

/** Minor units to a plain number for the form, and back. Thresholds compare against the request's own amount. */
const toMajor = (minor: number | null) => (minor === null ? '' : String(minor / 100));
const toMinor = (major: string) => (major.trim() === '' ? null : Math.round(Number(major) * 100));

export function Settings({ me }: { me: Me }) {
  const [data, setData] = useState<SettingsData | null>(null);
  const [roles, setRoles] = useState<RoleSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ kind: 'good' | 'bad'; text: string } | null>(null);
  const [rules, setRules] = useState<ApprovalRules>({ remindAfterHours: 24, escalateAfterHours: 48 });
  const [hrAddress, setHrAddress] = useState('');
  const [editing, setEditing] = useState<{ type: RequestTypeConfig; isNew: boolean } | null>(null);
  const { ask, dialog } = useReauth(me.fullName);

  const load = useCallback(async () => {
    try {
      const [s, r] = await Promise.all([api.get<SettingsData>('/api/settings'), api.get<RoleSummary[]>('/api/roles')]);
      setData(s);
      setRoles(r);
      setRules(s.rules);
      setHrAddress(s.hrAddress ?? '');
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => void load(), [load]);

  /** Saves with the password asked again, which every change on this screen needs. */
  async function save(fn: (reauth?: string) => Promise<unknown>, done: string): Promise<boolean> {
    setFlash(null);
    try {
      try {
        await fn();
      } catch (e) {
        if (!(e instanceof ApiRequestError && e.code === 'reauth_required')) throw e;
        const token = await ask();
        if (!token) return false;
        await fn(token);
      }
      setFlash({ kind: 'good', text: done });
      await load();
      return true;
    } catch (e) {
      setFlash({ kind: 'bad', text: e instanceof ApiRequestError ? e.message : 'Saving failed. Check your connection.' });
      return false;
    }
  }

  const roleName = (id: string) => roles.find((r) => r.id === id)?.name ?? 'Removed role';
  const rulesProblem = validateRules(rules);

  return (
    <>
      <div>
        <span className="quiet small">Owners only. Every change needs your password again and is recorded in the audit log.</span>
        <h1>Settings</h1>
      </div>
      {error && <div className="alert alert-bad" role="alert">{error}</div>}
      {flash && <div className={`alert alert-${flash.kind}`} role="status">{flash.text}</div>}
      {!data && !error && <p className="quiet">Loading…</p>}

      {data && (
        <>
          <section className="card" aria-labelledby="rt-h">
            <div className="row between wrap">
              <div className="col">
                <h2 id="rt-h">Request types</h2>
                <span className="quiet small">The HR system runs its own steps, then sends the request here. These are the Control Center’s steps for each type.</span>
              </div>
              <button className="btn" onClick={() => setEditing({ type: blankType(), isNew: true })}>Add request type</button>
            </div>
            <div className="scroll-x">
              <table className="people">
                <thead><tr><th>Type</th><th>Area</th><th>Steps</th><th>Rules</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {data.requestTypes.map((t) => (
                    <tr key={t.key}>
                      <td><span className="name">{t.name}</span><br /><span className="quiet small mono">{t.key}</span></td>
                      <td>{AREA[t.module]}</td>
                      <td className="small">
                        {t.steps.length === 0 ? <span className="quiet">None</span> : t.steps.map((s, i) => (
                          <span key={i}>{i > 0 && ' → '}{roleName(s.roleId)}{s.aboveMinor !== null && <span className="quiet"> (above {toMajor(s.aboveMinor)})</span>}</span>
                        ))}
                      </td>
                      <td className="small">
                        {[t.reauth && 'Password again', !t.delegable && 'No delegates', t.bulkAllowed && 'Bulk allowed', t.lockWhenApproved && 'Locks when approved'].filter(Boolean).join(' · ') || <span className="quiet">—</span>}
                      </td>
                      <td><span className={`pill ${t.active ? 'pill-good' : ''}`}>{t.active ? 'On' : 'Off'}</span></td>
                      <td className="actions"><button className="btn" onClick={() => setEditing({ type: structuredClone(t), isNew: false })}>Edit</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="quiet small" style={{ margin: 0 }}>
              A kind the HR system sends that isn’t set up here (or is switched off) is refused, and the HR system keeps it until it is. Requests already waiting keep the steps they started with.
            </p>
          </section>

          <div className="two">
            <section className="card" aria-labelledby="rem-h">
              <h2 id="rem-h">Reminders and escalation</h2>
              <p className="quiet small" style={{ margin: 0 }}>These only send notifications. Nothing is ever approved automatically.</p>
              <div className="field">
                <label htmlFor="rem">Remind the approver after (hours)</label>
                <input id="rem" className="input" type="number" min={1} max={720} value={rules.remindAfterHours} onChange={(e) => setRules({ ...rules, remindAfterHours: Number(e.target.value) })} />
              </div>
              <div className="field">
                <label htmlFor="esc">Escalate after (hours)</label>
                <input id="esc" className="input" type="number" min={2} max={1440} value={rules.escalateAfterHours} onChange={(e) => setRules({ ...rules, escalateAfterHours: Number(e.target.value) })} />
                <span className="quiet small">Escalation tells the next approver, or the owners for types without delegates.</span>
              </div>
              {rulesProblem && <div className="alert alert-warn">{rulesProblem}</div>}
              <div className="row end">
                <button className="btn btn-primary" disabled={Boolean(rulesProblem)} onClick={() => save((rt) => api.put('/api/settings/rules', rules, rt), 'Reminder rules saved.')}>Save</button>
              </div>
            </section>

            <section className="card" aria-labelledby="hr-h">
              <h2 id="hr-h">HR system address</h2>
              <p className="quiet small" style={{ margin: 0 }}>Where decisions are delivered. Requests and people changes arrive from the HR system on their own.</p>
              <div className="field">
                <label htmlFor="hr-url">Address</label>
                <input id="hr-url" className="input mono" type="url" placeholder="https://hr.example.com" value={hrAddress} onChange={(e) => setHrAddress(e.target.value)} />
              </div>
              <div className="row end">
                <button className="btn btn-primary" disabled={!hrAddress.trim()} onClick={() => save((rt) => api.put('/api/partners/hr', { baseUrl: hrAddress.trim() }, rt), 'HR system address saved.')}>Save</button>
              </div>
            </section>
          </div>
        </>
      )}

      {editing && (
        <TypeEditor
          initial={editing.type}
          isNew={editing.isNew}
          taken={data?.requestTypes.map((t) => t.key) ?? []}
          roles={roles}
          onCancel={() => setEditing(null)}
          onSave={async (t) => {
            const { key, ...body } = t;
            const ok = await save((rt) => api.put(`/api/request-types/${key}`, body, rt), `${t.name} saved. New requests of this type use these steps.`);
            if (ok) setEditing(null);
          }}
        />
      )}
      {dialog}
    </>
  );
}

function TypeEditor(props: {
  initial: RequestTypeConfig;
  isNew: boolean;
  taken: string[];
  roles: RoleSummary[];
  onCancel: () => void;
  onSave: (t: RequestTypeConfig) => Promise<void>;
}) {
  const [t, setT] = useState<RequestTypeConfig>(props.initial);
  const [amounts, setAmounts] = useState<string[]>(props.initial.steps.map((s) => toMajor(s.aboveMinor)));
  const [busy, setBusy] = useState(false);

  const steps: StepConfig[] = t.steps.map((s, i) => ({ ...s, aboveMinor: toMinor(amounts[i] ?? '') }));
  const candidate = { ...t, steps };
  const badAmount = amounts.some((a) => a.trim() !== '' && !(Number(a) >= 0));
  const keyTaken = props.isNew && props.taken.includes(t.key);
  const problem = keyTaken ? 'A request type with this key already exists.'
    : badAmount ? 'Amounts must be numbers of zero or more.'
    : validateRequestType(candidate, props.roles.map((r) => r.id));

  const setStep = (i: number, patch: Partial<StepConfig>) => setT({ ...t, steps: t.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const move = (i: number, by: number) => {
    const j = i + by;
    if (j < 0 || j >= t.steps.length) return;
    const s = [...t.steps];
    const a = [...amounts];
    [s[i], s[j]] = [s[j]!, s[i]!];
    [a[i], a[j]] = [a[j]!, a[i]!];
    setT({ ...t, steps: s });
    setAmounts(a);
  };
  const remove = (i: number) => {
    setT({ ...t, steps: t.steps.filter((_, j) => j !== i) });
    setAmounts(amounts.filter((_, j) => j !== i));
  };
  const add = () => {
    const role = props.roles[0];
    if (!role) return;
    setT({ ...t, steps: [...t.steps, { roleId: role.id, label: role.name, aboveMinor: null }] });
    setAmounts([...amounts, '']);
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (problem) return;
    setBusy(true);
    try {
      await props.onSave(candidate);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="overlay" onKeyDown={(e) => e.key === 'Escape' && props.onCancel()}>
      <form className="card dialog wide" role="dialog" aria-modal="true" aria-labelledby="te-h" onSubmit={submit}>
        <h2 id="te-h">{props.isNew ? 'Add request type' : `Edit ${props.initial.name}`}</h2>
        <div className="two">
          <div className="field">
            <label htmlFor="te-name">Name</label>
            <input id="te-name" className="input" autoFocus value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="te-key">Key the HR system sends</label>
            <input id="te-key" className="input mono" value={t.key} disabled={!props.isNew} placeholder="training_budget"
              onChange={(e) => setT({ ...t, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })} />
            {props.isNew && t.key && !KIND_PATTERN.test(t.key) && <span className="quiet small">Start with a letter; 2 to 40 characters.</span>}
          </div>
        </div>
        <div className="two">
          <div className="field">
            <label htmlFor="te-area">Who can see these requests</label>
            <select id="te-area" className="input" value={t.module} onChange={(e) => setT({ ...t, module: e.target.value as Module })}>
              {AREAS.map((m) => <option key={m} value={m}>Roles with {AREA[m]} access</option>)}
            </select>
          </div>
          <div className="field">
            <span className="label">Status</span>
            <label className="row toggle-line">
              <input type="checkbox" checked={t.active} onChange={(e) => setT({ ...t, active: e.target.checked })} /> Accept requests of this type
            </label>
          </div>
        </div>

        <fieldset className="col gap" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend><h3 style={{ margin: '0 0 6px' }}>Steps, in order</h3></legend>
          {t.steps.length === 0 && <p className="quiet small" style={{ margin: 0 }}>No steps yet.</p>}
          {t.steps.map((s, i) => (
            <div key={i} className="step-edit">
              <span className="mono quiet">{i + 1}</span>
              <select aria-label={`Step ${i + 1} role`} className="input" value={s.roleId} onChange={(e) => setStep(i, { roleId: e.target.value })}>
                {props.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
              <input aria-label={`Step ${i + 1} label`} className="input grow" value={s.label} onChange={(e) => setStep(i, { label: e.target.value })} />
              <input aria-label={`Step ${i + 1}: only when the amount is above`} className="input mono amount-in" inputMode="decimal" placeholder="Any amount"
                value={amounts[i] ?? ''} onChange={(e) => setAmounts(amounts.map((a, j) => (j === i ? e.target.value : a)))} />
              <button type="button" className="icon-btn" aria-label={`Move step ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
              <button type="button" className="icon-btn" aria-label={`Move step ${i + 1} down`} disabled={i === t.steps.length - 1} onClick={() => move(i, 1)}>↓</button>
              <button type="button" className="icon-btn" aria-label={`Remove step ${i + 1}`} onClick={() => remove(i)}>×</button>
            </div>
          ))}
          <div className="row between wrap">
            <button type="button" className="btn" onClick={add} disabled={t.steps.length >= 8}>Add step</button>
            <span className="quiet small">Leave the amount empty for a step that always applies. An amount adds the step only above it, in the request’s own currency.</span>
          </div>
        </fieldset>

        <div className="checks">
          <label className="row"><input type="checkbox" checked={t.reauth} onChange={(e) => setT({ ...t, reauth: e.target.checked })} /> Approving needs the password again</label>
          <label className="row"><input type="checkbox" checked={t.delegable} onChange={(e) => setT({ ...t, delegable: e.target.checked })} /> A delegate may approve while the approver is away</label>
          <label className="row"><input type="checkbox" checked={t.bulkAllowed} onChange={(e) => setT({ ...t, bulkAllowed: e.target.checked })} /> Allow bulk approval when the HR system marks it as checked</label>
          <label className="row"><input type="checkbox" checked={t.lockWhenApproved} onChange={(e) => setT({ ...t, lockWhenApproved: e.target.checked })} /> Lock once approved; any change needs every step again</label>
        </div>
        <p className="quiet small" style={{ margin: 0 }}>Nobody can approve their own request, and nobody can sign two steps of one request.</p>

        {problem && <div className="alert alert-warn" role="status">{problem}</div>}
        <div className="row end">
          <button type="button" className="btn" onClick={props.onCancel}>Cancel</button>
          <button className="btn btn-primary" disabled={Boolean(problem) || busy}>Save</button>
        </div>
      </form>
    </div>
  );
}
