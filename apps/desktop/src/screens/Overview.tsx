import { useEffect, useState } from 'react';
import { formatMoney, type Me, type OverviewData } from '@ceo/shared';
import { api } from '../api';
import { SystemLabel, WaitingRow } from './parts';

export function Overview({ me, onOpen, onAll }: { me: Me; onOpen: (id: string) => void; onAll: () => void }) {
  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.overview().then(setData).catch((e: Error) => setError(e.message));
  }, []);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <>
      <div>
        <span className="quiet small">{new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</span>
        <h1>{greeting}, {me.fullName.split(' ')[0]}.</h1>
      </div>
      {error && <div className="alert alert-bad" role="alert">{error}</div>}
      {!data && !error && <p className="quiet">Loading…</p>}
      {data && (
        <>
          <section className="card" aria-labelledby="wait-h">
            <div className="row between">
              <h2 id="wait-h">Waiting on you <span className="quiet">({data.counts.waitingOnYou})</span></h2>
              <button className="link" onClick={onAll}>All approvals →</button>
            </div>
            {data.waiting.length === 0 && <p className="quiet">Nothing is waiting on you.</p>}
            <div className="list">{data.waiting.map((r) => <WaitingRow key={r.id} r={r} onOpen={() => onOpen(r.id)} />)}</div>
          </section>

          <section className="tiles" aria-label="Key numbers">
            <div className="card tile"><span className="quiet small">Waiting on you</span><span className="big mono">{data.counts.waitingOnYou}</span></div>
            <div className="card tile"><span className="quiet small">Waiting over the reminder time</span><span className="big mono">{data.counts.overdue}</span></div>
            <div className="card tile"><span className="quiet small">Open requests you can see</span><span className="big mono">{data.counts.openTotal}</span></div>
            <div className="card tile"><span className="quiet small">You decided this week</span><span className="big mono">{data.counts.decidedThisWeek}</span></div>
          </section>

          <div className="two">
            <section className="card" aria-labelledby="money-h">
              <h2 id="money-h">Money waiting for a decision</h2>
              <p className="quiet small">Shown per currency; nothing is converted.</p>
              {data.pendingByCurrency.length === 0 && <p className="quiet">None.</p>}
              {data.pendingByCurrency.map((m) => (
                <div key={m.currency} className="row between line"><span>{m.currency}</span><span className="mono">{formatMoney(m)}</span></div>
              ))}
            </section>
            <section className="card" aria-labelledby="sys-h">
              <h2 id="sys-h">Connected systems</h2>
              {data.systems.map((s) => (
                <div key={s.system} className="sys">
                  <div className="row between">
                    <SystemLabel system={s.system} />
                    <span className={`pill ${s.connected ? 'pill-good' : 'pill-warn'}`}>{s.connected ? 'Address set' : 'No address yet'}</span>
                  </div>
                  <div className="row between line small"><span className="quiet">Last message</span><span>{s.lastMessageAt ? new Date(s.lastMessageAt).toLocaleString() : 'None yet'}</span></div>
                  <div className="row between line small"><span className="quiet">Decisions waiting to send</span><span>{s.outboxWaiting}{s.oldestWaitingMinutes ? ` · oldest ${s.oldestWaitingMinutes} min` : ''}</span></div>
                  <div className="row between line small"><span className="quiet">Contract version</span><span>{s.contractVersion ?? '—'}</span></div>
                </div>
              ))}
            </section>
          </div>
        </>
      )}
    </>
  );
}
