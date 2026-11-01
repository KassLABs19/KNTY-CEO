import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ApiRequestError, type InviteCreated, type Me, type PeopleChange, type PersonRow, type RoleSummary } from '@ceo/shared';
import { api } from '../api';
import { ConfirmDialog, useReauth } from './dialogs';

type Filter = 'all' | 'active' | 'invited' | 'suspended' | 'none';
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'Everyone' },
  { id: 'active', label: 'Active' },
  { id: 'invited', label: 'Invited' },
  { id: 'suspended', label: 'Suspended' },
  { id: 'none', label: 'No login' },
];

const LOGIN: Record<PersonRow['login'], [string, string]> = {
  active: ['Active', 'pill-good'],
  invited: ['Invite sent', 'pill-info'],
  suspended: ['Suspended', 'pill-bad'],
  none: ['No login', ''],
};

type Confirm = { kind: 'suspend' | 'cancel'; person: PersonRow } | null;

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—');

export function Logins({ me }: { me: Me }) {
  const [people, setPeople] = useState<PersonRow[] | null>(null);
  const [changes, setChanges] = useState<PeopleChange[]>([]);
  const [roles, setRoles] = useState<RoleSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ kind: 'good' | 'bad'; text: string } | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [invitePerson, setInvitePerson] = useState('');
  const [inviteRole, setInviteRole] = useState('');
  const [created, setCreated] = useState<(InviteCreated & { name: string }) | null>(null);
  const [backup, setBackup] = useState('');
  const inviteRef = useRef<HTMLSelectElement>(null);
  const { ask, dialog } = useReauth(me.fullName);

  const load = useCallback(async () => {
    try {
      const [p, c, r] = await Promise.all([
        api.get<PersonRow[]>('/api/people'),
        api.get<PeopleChange[]>('/api/people/changes'),
        api.get<RoleSummary[]>('/api/roles'),
      ]);
      setPeople(p);
      setChanges(c);
      setRoles(r);
      setInviteRole((v) => v || r.find((x) => x.key === 'dept_head')?.id || r[0]?.id || '');
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => void load(), [load]);

  /** Runs an action, asking for the password again when the server says it's needed. */
  async function run(label: string, fn: (reauth?: string) => Promise<unknown>, done: string) {
    setFlash(null);
    try {
      try {
        await fn();
      } catch (e) {
        if (!(e instanceof ApiRequestError && e.code === 'reauth_required')) throw e;
        const token = await ask();
        if (!token) return;
        await fn(token);
      }
      setFlash({ kind: 'good', text: done });
      setOpen(null);
      await load();
    } catch (e) {
      setFlash({ kind: 'bad', text: e instanceof ApiRequestError ? e.message : `${label} failed. Check your connection.` });
    }
  }

  async function invite(e: FormEvent) {
    e.preventDefault();
    const person = people?.find((p) => p.id === invitePerson);
    if (!person || !inviteRole) return setFlash({ kind: 'bad', text: 'Choose a person and a role.' });
    setFlash(null);
    try {
      const res = await api.post<InviteCreated>(`/api/people/${person.id}/invite`, { roleId: inviteRole });
      setCreated({ ...res, name: person.fullName });
      setInvitePerson('');
      await load();
    } catch (err) {
      setFlash({ kind: 'bad', text: err instanceof ApiRequestError ? err.message : 'The invite failed. Check your connection.' });
    }
  }

  function startInvite(personId: string) {
    setInvitePerson(personId);
    setCreated(null);
    inviteRef.current?.focus();
    inviteRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  const invitable = (people ?? []).filter((p) => p.login === 'none' && !p.leftOn);
  const owners = (people ?? []).filter((p) => p.isOwner && p.login === 'active');
  const backupCandidates = (people ?? []).filter((p) => !p.isOwner && p.login === 'active' && p.twoStep);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (people ?? []).filter((p) => (filter === 'all' || p.login === filter) && (!q || `${p.fullName} ${p.email} ${p.department ?? ''}`.toLowerCase().includes(q)));
  }, [people, filter, query]);
  const counts = (f: Filter) => (people ?? []).filter((p) => f === 'all' || p.login === f).length;

  if (error) return <div className="alert alert-bad" role="alert">{error}</div>;

  return (
    <>
      <div className="row between wrap">
        <div>
          <span className="quiet small">People and departments come from the HR system. Logins and roles are set here.</span>
          <h1>Logins &amp; people</h1>
        </div>
      </div>
      {flash && <div className={`alert alert-${flash.kind}`} role="status">{flash.text}</div>}

      <section className="card" aria-labelledby="sync-h">
        <div className="row between wrap">
          <h2 id="sync-h">From the HR system</h2>
          <span className="quiet small">Last 14 days · logins follow these changes automatically</span>
        </div>
        {changes.length === 0 && <p className="quiet">No joiners, movers or leavers in the last 14 days.</p>}
        <div className="list">
          {changes.map((c) => {
            const person = people?.find((p) => p.employeeId === c.employeeId);
            return (
              <div key={c.id} className="change">
                <span className={`pill ${c.event === 'leaver' ? 'pill-bad' : c.event === 'joiner' ? 'pill-good' : 'pill-info'}`}>{{ joiner: 'Joiner', mover: 'Mover', leaver: 'Leaver' }[c.event]}</span>
                <span className="grow">
                  <strong>{c.name}</strong>{' '}
                  {c.event === 'joiner' && <>joined{c.department ? ` ${c.department}` : ''}{c.jobTitle ? ` as ${c.jobTitle}` : ''}.{c.login ? '' : ' No login yet.'}</>}
                  {c.event === 'mover' && <>moved{c.department ? ` to ${c.department}` : ''}{c.jobTitle ? `, now ${c.jobTitle}` : ''}. {c.needsRoleReview ? 'Check that their role still fits.' : 'What they can see follows the new department.'}</>}
                  {c.event === 'leaver' && <>left{c.leftOn ? ` on ${new Date(`${c.leftOn}T12:00:00`).toLocaleDateString(undefined, { dateStyle: 'medium' })}` : ''}. {c.login === 'suspended' ? 'Their login was suspended and they were signed out everywhere.' : 'They had no login.'}</>}
                  <span className="quiet small"> · {when(c.at)}</span>
                </span>
                {c.event === 'joiner' && person && person.login === 'none' && !person.leftOn && (
                  <button className="btn" onClick={() => startInvite(person.id)}>Invite</button>
                )}
                {c.event === 'mover' && person?.needsRoleReview && person.userId && (
                  <button className="btn" onClick={() => { setFilter('all'); setQuery(person.fullName); setOpen(person.id); }}>Review role</button>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <div className="two">
        <section className="card" aria-labelledby="own-h">
          <h2 id="own-h">Account owners</h2>
          <p className="quiet small" style={{ margin: 0 }}>Owners manage logins, access and settings. Keep a backup owner so the company can’t be locked out.</p>
          {owners.map((o) => (
            <div key={o.id} className="row between line">
              <span className="col"><span>{o.fullName}{o.userId === me.id ? ' (you)' : ''}</span><span className="quiet small">{o.roleName} · two-step {o.twoStep ? 'on' : 'not set'}</span></span>
              {o.userId !== me.id && owners.length > 1 && (
                <button className="btn btn-danger" onClick={() => run('Removing the owner', (t) => api.put(`/api/users/${o.userId}/owner`, { owner: false }, t), `${o.fullName} is no longer an owner.`)}>Remove as owner</button>
              )}
            </div>
          ))}
          {owners.length < 2 && <div className="alert alert-warn">There is no backup owner. If {owners[0]?.userId === me.id ? 'your' : 'the owner’s'} account is lost, nobody can manage logins.</div>}
          <div className="row wrap">
            <label htmlFor="bk" className="sr-only">Backup owner</label>
            <select id="bk" className="input grow" value={backup} onChange={(e) => setBackup(e.target.value)}>
              <option value="">{backupCandidates.length ? 'Choose someone to add as an owner…' : 'Nobody eligible yet (needs an active login with two-step on)'}</option>
              {backupCandidates.map((p) => <option key={p.id} value={p.userId!}>{p.fullName} · {p.roleName}</option>)}
            </select>
            <button className="btn btn-primary" disabled={!backup} onClick={() => run('Adding the owner', (t) => api.put(`/api/users/${backup}/owner`, { owner: true }, t), 'Owner added.').then(() => setBackup(''))}>Make owner</button>
          </div>
        </section>

        <section className="card" aria-labelledby="inv-h">
          <h2 id="inv-h">Invite someone</h2>
          <p className="quiet small" style={{ margin: 0 }}>Only people in the HR system can get a login. They set their own password from a one-time link that expires after 48 hours.</p>
          <form className="col gap" onSubmit={invite}>
            <div className="field">
              <label htmlFor="inv-person">Person</label>
              <select id="inv-person" ref={inviteRef} className="input" value={invitePerson} onChange={(e) => { setInvitePerson(e.target.value); setCreated(null); }}>
                <option value="">{invitable.length ? 'Choose from the HR system…' : 'Everyone in the HR system already has a login'}</option>
                {invitable.map((p) => <option key={p.id} value={p.id}>{p.fullName}{p.department ? ` · ${p.department}` : ''}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="inv-role">Role</label>
              <select id="inv-role" className="input" value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
                {roles.map((r) => <option key={r.id} value={r.id}>{r.name}{r.requires2fa ? ' (two-step required)' : ''}</option>)}
              </select>
            </div>
            <button className="btn btn-primary" disabled={!invitePerson}>Create invite link</button>
          </form>
          {created && <InviteLink created={created} />}
        </section>
      </div>

      <section className="card flush" aria-labelledby="ppl-h">
        <div className="row between wrap pad-x">
          <h2 id="ppl-h">People <span className="quiet">({people?.length ?? 0})</span></h2>
          <div className="row wrap">
            <div className="chips" role="group" aria-label="Filter people">
              {FILTERS.map((f) => <button key={f.id} className="chip" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>{f.label} ({counts(f.id)})</button>)}
            </div>
            <label htmlFor="ppl-q" className="sr-only">Search people</label>
            <input id="ppl-q" className="input" type="search" placeholder="Search name, email, department" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
        </div>
        {people === null && <p className="quiet pad">Loading…</p>}
        <div className="scroll-x">
          <table className="people">
            <thead><tr><th>Person</th><th>Role</th><th>Department</th><th>Two-step</th><th>Login</th><th>Last sign-in</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {shown.map((p) => (
                <PersonRows key={p.id} p={p} me={me} roles={roles} open={open === p.id}
                  onToggle={() => setOpen(open === p.id ? null : p.id)}
                  onInvite={() => startInvite(p.id)}
                  onConfirm={(kind) => setConfirm({ kind, person: p })}
                  run={run}
                  onResent={(c) => setCreated({ ...c, name: p.fullName })} />
              ))}
            </tbody>
          </table>
          {people && shown.length === 0 && <p className="quiet pad">Nobody matches.</p>}
        </div>
      </section>

      {confirm?.kind === 'suspend' && (
        <ConfirmDialog title={`Suspend ${confirm.person.fullName}?`} confirmLabel="Suspend" danger onCancel={() => setConfirm(null)}
          onConfirm={() => { const p = confirm.person; setConfirm(null); void run('Suspending', () => api.post(`/api/users/${p.userId}/suspend`, {}), `${p.fullName} is suspended and signed out everywhere.`); }}>
          They’ll be signed out of every device straight away and can’t sign in until an owner reactivates them. Delegations to and from them end. This is recorded in the audit log.
        </ConfirmDialog>
      )}
      {confirm?.kind === 'cancel' && (
        <ConfirmDialog title="Cancel this invite?" confirmLabel="Cancel invite" danger onCancel={() => setConfirm(null)}
          onConfirm={() => { const p = confirm.person; setConfirm(null); void run('Cancelling', () => api.delete(`/api/users/${p.userId}/invite`), `The invite for ${p.fullName} no longer works.`); }}>
          The link stops working straight away. You can invite {confirm.person.fullName} again later.
        </ConfirmDialog>
      )}
      {dialog}
    </>
  );
}

function InviteLink({ created }: { created: InviteCreated & { name: string } }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="alert alert-good col gap" role="status">
      <span><strong>Invite link for {created.name}.</strong> It’s shown only once: copy it and send it to them directly. It expires {when(created.expiresAt)}.</span>
      <div className="row">
        <code className="code grow">{created.inviteLink}</code>
        <button className="btn" onClick={async () => { await navigator.clipboard.writeText(created.inviteLink); setCopied(true); }}>{copied ? 'Copied' : 'Copy'}</button>
      </div>
    </div>
  );
}

function PersonRows(props: {
  p: PersonRow;
  me: Me;
  roles: RoleSummary[];
  open: boolean;
  onToggle: () => void;
  onInvite: () => void;
  onConfirm: (kind: 'suspend' | 'cancel') => void;
  run: (label: string, fn: (reauth?: string) => Promise<unknown>, done: string) => Promise<void>;
  onResent: (c: InviteCreated) => void;
}) {
  const { p, me, roles, open, run } = props;
  const [role, setRole] = useState(p.roleId ?? '');
  const self = p.userId === me.id;
  const [label, cls] = LOGIN[p.login];
  const twoStep = p.login === 'none' ? '—' : p.twoStep ? 'On' : p.twoStepRequired ? (p.login === 'invited' ? 'At first sign-in' : 'Required · not set') : 'Off';

  async function resend() {
    try {
      props.onResent(await api.post<InviteCreated>(`/api/people/${p.id}/invite`, { roleId: p.roleId, owner: p.isOwner }));
    } catch (e) {
      await run('Resending', () => Promise.reject(e), '');
    }
  }

  return (
    <>
      <tr className={open ? 'open' : ''}>
        <td><span className="col"><span className="name">{p.fullName}</span><span className="quiet small">{p.email}</span></span></td>
        <td>
          {p.roleName ?? <span className="quiet">—</span>}
          {p.isOwner && <span className="pill pill-info tag">Owner</span>}
          {p.needsRoleReview && p.userId && <span className="pill pill-warn tag">Review</span>}
        </td>
        <td>{p.department ?? '—'}</td>
        <td className={!p.twoStep && p.twoStepRequired && p.login === 'active' ? 'warn-text' : ''}>{twoStep}</td>
        <td>
          <span className={`pill ${cls}`}>{p.leftOn && p.login === 'suspended' ? 'Suspended · left' : label}</span>
          {p.locked && <span className="pill pill-warn tag">Locked</span>}
        </td>
        <td className="small">{p.login === 'invited' ? `Link expires ${when(p.inviteExpiresAt)}` : when(p.lastSignInAt)}</td>
        <td className="actions">
          {self ? <span className="quiet small">You</span>
            : p.login === 'none' ? (p.leftOn ? <span className="quiet small">Left</span> : <button className="btn" onClick={props.onInvite}>Invite</button>)
            : <button className="btn icon" aria-expanded={open} aria-label={`Actions for ${p.fullName}`} onClick={props.onToggle}>⋯</button>}
        </td>
      </tr>
      {open && !self && (
        <tr className="row-actions">
          <td colSpan={7}>
            <div className="row wrap end">
              {p.login === 'invited' && (
                <>
                  <button className="btn" onClick={resend}>Send a new link</button>
                  <button className="btn btn-danger" onClick={() => props.onConfirm('cancel')}>Cancel invite</button>
                </>
              )}
              {p.login === 'active' && (
                <>
                  <label htmlFor={`role-${p.id}`} className="small">Role</label>
                  <select id={`role-${p.id}`} className="input" value={role} onChange={(e) => setRole(e.target.value)}>
                    {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                  <button className="btn btn-primary" disabled={role === p.roleId && !p.needsRoleReview}
                    onClick={() => run('Changing the role', (t) => api.put(`/api/users/${p.userId}/role`, { roleId: role }, t), role === p.roleId ? `${p.fullName} keeps the ${p.roleName} role.` : `${p.fullName}’s role was changed.`)}>
                    {role === p.roleId && p.needsRoleReview ? 'Keep this role' : 'Save role'}
                  </button>
                  {p.locked && <button className="btn" onClick={() => run('Unlocking', () => api.post(`/api/users/${p.userId}/unlock`, {}), `${p.fullName} can sign in again.`)}>Unlock</button>}
                  <button className="btn btn-danger" onClick={() => props.onConfirm('suspend')}>Suspend</button>
                </>
              )}
              {p.login === 'suspended' && (p.leftOn
                ? <span className="quiet small">{p.fullName} has left the company. The HR system must record a rehire before they can have a login again.</span>
                : <button className="btn btn-primary" onClick={() => run('Reactivating', () => api.post(`/api/users/${p.userId}/reactivate`, {}), `${p.fullName} can sign in again.`)}>Reactivate</button>)}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
