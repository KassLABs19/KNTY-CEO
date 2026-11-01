import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiRequestError, formatMoney, type Me, type RequestDetail, type RequestFilter, type RequestSummary } from '@ceo/shared';
import { api } from '../api';
import { STATUS, SystemLabel, ageText } from './parts';

const FILTERS: { id: RequestFilter; label: string }[] = [
  { id: 'mine', label: 'Your step' },
  { id: 'all', label: 'All' },
  { id: 'hr', label: 'HR system' },
  { id: 'predicto', label: 'Predicto' },
  { id: 'decided', label: 'Decided' },
];

export function Approvals({ me, initialId }: { me: Me; initialId: string | null }) {
  const [filter, setFilter] = useState<RequestFilter>('mine');
  const [rows, setRows] = useState<RequestSummary[] | null>(null);
  const [selected, setSelected] = useState<string | null>(initialId);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<{ kind: 'good' | 'bad'; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.requests(filter).then((r) => {
      setRows(r);
      setSelected((s) => s ?? r[0]?.id ?? null);
    }).catch((e: Error) => setError(e.message));
  }, [filter]);
  useEffect(load, [load]);

  const eligible = (rows ?? []).filter((r) => r.bulkEligible);
  const chosen = eligible.filter((r) => checked.has(r.id));

  async function bulkApprove() {
    setMessage(null);
    try {
      const res = await api.bulkApprove(chosen.map((r) => ({ id: r.id, version: r.version })));
      setChecked(new Set());
      setMessage(res.failed.length
        ? { kind: 'bad', text: `${res.approved.length} approved. ${res.failed.length} could not be: ${res.failed.map((f) => f.message).join(' ')}` }
        : { kind: 'good', text: `${res.approved.length} approved. The partner system has been sent the decisions.` });
      load();
    } catch (e) {
      setMessage({ kind: 'bad', text: e instanceof ApiRequestError ? e.message : 'Could not reach the server.' });
    }
  }

  return (
    <>
      <div>
        <span className="quiet small">Requests from every connected system that reached the Control Center</span>
        <h1>Approvals</h1>
      </div>
      {error && <div className="alert alert-bad" role="alert">{error}</div>}
      <div className="row between wrap">
        <div className="chips" role="group" aria-label="Filter requests">
          {FILTERS.map((f) => (
            <button key={f.id} className="chip" aria-pressed={filter === f.id} onClick={() => { setFilter(f.id); setSelected(null); setChecked(new Set()); }}>{f.label}</button>
          ))}
        </div>
        {eligible.length > 0 && (
          <button className="btn" onClick={() => setChecked(new Set(eligible.map((r) => r.id)))}>Select all that passed checks ({eligible.length})</button>
        )}
      </div>
      {chosen.length > 0 && (
        <div className="bulkbar" role="region" aria-label="Bulk actions">
          <span className="grow"><strong>{chosen.length} selected</strong> · all passed the partner’s checks</span>
          <button className="btn" onClick={() => setChecked(new Set())}>Clear</button>
          <button className="btn btn-light" onClick={bulkApprove}>Approve selected</button>
        </div>
      )}
      {message && <div className={`alert alert-${message.kind}`} role="status">{message.text}</div>}

      <div className="split">
        <section className="card flush" aria-label="Requests">
          {rows === null && <p className="quiet pad">Loading…</p>}
          {rows?.length === 0 && <p className="quiet pad">Nothing here.</p>}
          {rows?.map((r) => (
            <div key={r.id} className={`req-line ${selected === r.id ? 'selected' : ''}`}>
              {r.bulkEligible ? (
                <label className="check">
                  <input type="checkbox" checked={checked.has(r.id)} aria-label={`Select ${r.title}, ${r.subtitle}`}
                    onChange={() => setChecked((c) => { const n = new Set(c); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })} />
                </label>
              ) : eligible.length > 0 ? <span className="check" aria-hidden="true" /> : null}
              <button className="req-row" aria-pressed={selected === r.id} onClick={() => setSelected(r.id)}>
                <SystemLabel system={r.system} />
                <span className="grow col">
                  <span className="title">{r.title}</span>
                  <span className="quiet small">{r.subtitle}{r.onBehalfOf ? ` · for ${r.onBehalfOf}` : ''} · {ageText(r.ageHours)}</span>
                </span>
                {r.changedUpstream && <span className="pill pill-warn">Changed upstream</span>}
                {r.overdue && <span className="pill pill-warn">Waiting too long</span>}
                <span className="end">
                  <span className="mono amount">{r.money ? formatMoney(r.money) : '—'}</span>
                  {filter !== 'mine' && <span className={`pill ${STATUS[r.status]![1]}`}>{STATUS[r.status]![0]}</span>}
                </span>
              </button>
            </div>
          ))}
        </section>
        {selected && <Detail key={selected} id={selected} me={me} onChanged={load} />}
      </div>
    </>
  );
}

function Detail({ id, me, onChanged }: { id: string; me: Me; onChanged: () => void }) {
  const [d, setD] = useState<RequestDetail | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reauth, setReauth] = useState(false);

  const load = useCallback(() => api.request(id).then(setD).catch((e: Error) => setError(e.message)), [id]);
  useEffect(() => void load(), [load]);

  async function act(decision: 'approve' | 'reject' | 'send_back', reauthToken?: string) {
    if (!d) return;
    if (decision === 'approve' && d.needsReauth && !reauthToken) return setReauth(true);
    setBusy(true);
    setError(null);
    try {
      setD(await api.decide(d.id, { decision, version: d.version, note: note || undefined }, reauthToken));
      setNote('');
      onChanged();
    } catch (e) {
      if (e instanceof ApiRequestError && e.code === 'stale_version') await load();
      if (e instanceof ApiRequestError && e.code === 'reauth_required') setReauth(true);
      setError(e instanceof ApiRequestError ? e.message : 'Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  if (error && !d) return <section className="card"><div className="alert alert-bad">{error}</div></section>;
  if (!d) return <section className="card"><p className="quiet">Loading…</p></section>;
  const canDecide = d.status === 'pending' && !d.blockedReason;

  return (
    <section className="card detail" aria-labelledby="det-h">
      <span className="quiet small">{d.ref} · <SystemLabel system={d.system} /> · trace <span className="mono">{d.traceId}</span> · version {d.version}</span>
      <h2 id="det-h">{d.title}</h2>
      <span>{d.subtitle}</span>

      {d.changedUpstream && <div className="alert alert-warn" role="alert"><strong>Changed in the {d.system === 'hr' ? 'HR system' : 'Predicto'} after it reached this step.</strong> You’re now looking at version {d.version}. Earlier approvals in the Control Center were reset.</div>}
      {d.onBehalfOf && <div className="alert alert-info">You’re deciding this for {d.onBehalfOf} (delegation). The audit log records both names.</div>}
      {d.overdue && d.status === 'pending' && <div className="alert alert-warn">Waiting {ageText(d.ageHours).replace(' ago', '')}. Reminders and escalation have gone out; nothing is ever approved automatically.</div>}

      <dl className="facts">
        {d.facts.map((f) => <div key={f.label}><dt>{f.label}</dt><dd>{f.value}</dd></div>)}
        {d.money && <div><dt>Amount</dt><dd className="mono">{formatMoney(d.money)}</dd></div>}
        {d.hasMaskedSalary && <div><dt>Salary</dt><dd><span className="mono" aria-label="Hidden">••••••</span> <span className="quiet small">Shown only to roles that manage payroll, after the password (next build)</span></dd></div>}
      </dl>

      <div>
        <h3>Approval chain</h3>
        <ol className="chain">
          {d.chain.map((s, i) => (
            <li key={i} className={`step ${s.state}`}>
              <span className="dot" aria-hidden="true">{s.state === 'done' ? '✓' : s.state === 'now' ? '•' : ''}</span>
              <span className="grow col">
                <span>{s.label}</span>
                {s.decidedBy && s.owner === 'console' && <span className="quiet small">{s.decidedBy}{s.onBehalfOf ? ` for ${s.onBehalfOf}` : ''}{s.note ? ` — “${s.note}”` : ''}</span>}
              </span>
              <span className="pill">{s.owner === 'partner' ? (d.system === 'hr' ? 'HR system' : 'Predicto') : 'Control Center'}</span>
              <span className="quiet small state">{{ done: 'Done', now: 'Waiting', later: 'Not yet', rejected: 'Rejected', returned: 'Sent back' }[s.state]}</span>
            </li>
          ))}
        </ol>
        {d.kind === 'payroll' && <p className="quiet small">Payroll needs two different signers, CFO then CEO, and locks once both have signed.</p>}
      </div>

      {d.status === 'pending' && d.blockedReason && <div className="alert alert-info">{d.blockedReason}</div>}
      {error && <div className="alert alert-bad" role="alert">{error}</div>}
      {canDecide && (
        <div className="decide">
          <div className="field">
            <label htmlFor="note">Note <span className="quiet">(needed to send back)</span></label>
            <textarea id="note" className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div className="row wrap">
            <button className="btn btn-primary" disabled={busy} onClick={() => act('approve')}>{d.kind === 'payroll' ? 'Sign and approve' : d.changedUpstream ? `Approve version ${d.version}` : 'Approve'}</button>
            <button className="btn" disabled={busy || !note.trim()} onClick={() => act('send_back')}>Send back for changes</button>
            <button className="btn btn-danger" disabled={busy} onClick={() => act('reject')}>Reject</button>
          </div>
        </div>
      )}
      {d.status !== 'pending' && <div className="alert alert-info">{STATUS[d.status]![0]}. {d.status === 'returned' ? 'It’s back with the requester and starts again from the first step when resubmitted.' : 'The decision is sent to the partner system and recorded in the audit log.'}</div>}

      <details>
        <summary>History</summary>
        <ul className="history">{d.events.map((e, i) => <li key={i}><span className="quiet small">{new Date(e.at).toLocaleString()} · {e.who}</span><br />{e.what}</li>)}</ul>
      </details>

      {reauth && <ReauthDialog name={me.fullName} onCancel={() => setReauth(false)} onConfirmed={(t) => { setReauth(false); void act('approve', t); }} />}
    </section>
  );
}

/** Asks for the password again before a sensitive action. */
export function ReauthDialog({ name, onCancel, onConfirmed }: { name: string; onCancel: () => void; onConfirmed: (token: string) => void }) {
  const [pw, setPw] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onConfirmed((await api.reauth(pw)).reauthToken);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not reach the server.');
    } finally {
      setBusy(false);
      setPw('');
    }
  }
  return (
    <div className="overlay" onKeyDown={(e) => e.key === 'Escape' && onCancel()}>
      <form className="card dialog" role="dialog" aria-modal="true" aria-labelledby="ra-h" onSubmit={submit}>
        <h2 id="ra-h">Confirm it’s you, {name.split(' ')[0]}</h2>
        <p style={{ margin: 0 }}>This needs your password again.</p>
        {error && <div className="alert alert-bad" role="alert">{error}</div>}
        <div className="field">
          <label htmlFor="ra-pw">Password</label>
          <input id="ra-pw" className="input" type="password" autoComplete="current-password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} />
        </div>
        <div className="row end">
          <button type="button" className="btn" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" disabled={!pw || busy}>Confirm</button>
        </div>
      </form>
    </div>
  );
}
