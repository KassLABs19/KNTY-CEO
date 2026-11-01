import { useCallback, useEffect, useState } from 'react';
import { canAccess, type Me, type Module } from '@ceo/shared';
import { api } from '../api';
import { bridge } from '../bridge';
import { Overview } from './Overview';
import { Approvals } from './Approvals';
import { AuditLog } from './AuditLog';
import { Logins } from './Logins';

type Page = 'overview' | 'approvals' | 'logins' | 'access' | 'audit' | 'settings';

const PAGES: { id: Page; label: string; module: Module; icon: string }[] = [
  { id: 'overview', label: 'Overview', module: 'overview', icon: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z' },
  { id: 'approvals', label: 'Approvals', module: 'approvals', icon: 'M4 4h16v16H4zM8 12l3 3 5-6' },
  { id: 'logins', label: 'Logins & people', module: 'logins', icon: 'M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM3 21c0-4 3-6 7-6 1.5 0 2.8.3 4 .8M19 14v6M16 17h6' },
  { id: 'access', label: 'Access & roles', module: 'access', icon: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4' },
  { id: 'audit', label: 'Audit log', module: 'audit', icon: 'M12 7v5l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z' },
  { id: 'settings', label: 'Settings', module: 'settings', icon: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M16 4v4M10 10v4M18 16v4' },
];

interface Note {
  id: number;
  kind: string;
  text: string;
  requestId: string | null;
  createdAt: string;
  read: boolean;
}

export function Shell({ me, env, appVersion, onSignOut }: { me: Me; env: string; appVersion: string; onSignOut: () => void }) {
  // Only show what this person may open. The server enforces the same rule.
  const visible = PAGES.filter((p) => canAccess({ isOwner: me.isOwner, levels: me.role.levels }, p.module));
  const [page, setPage] = useState<Page>('overview');
  const [openRequest, setOpenRequest] = useState<string | null>(null);
  const [update, setUpdate] = useState<{ state: string; detail?: string } | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [bellOpen, setBellOpen] = useState(false);

  const loadNotes = useCallback(() => api.get<Note[]>('/api/notifications').then(setNotes).catch(() => undefined), []);
  useEffect(() => bridge.onUpdate(setUpdate), []);
  useEffect(() => {
    void loadNotes();
    const t = window.setInterval(() => void loadNotes(), 60_000);
    return () => window.clearInterval(t);
  }, [loadNotes]);

  const unread = notes.filter((n) => !n.read).length;
  const goToRequest = (id: string) => {
    setOpenRequest(id);
    setPage('approvals');
    setBellOpen(false);
  };

  return (
    <div className="layout">
      <nav className="side" aria-label="Main">
        <div className="brand"><span className="mark" aria-hidden="true">CEO</span><span><strong>KNTY CEO</strong><br /><span className="quiet small">{me.company.name}</span></span></div>
        {visible.map((p) => (
          <button key={p.id} className="nav" aria-current={page === p.id ? 'page' : undefined} onClick={() => { setPage(p.id); setOpenRequest(null); }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={p.icon} /></svg>
            {p.label}
          </button>
        ))}
        <div className="spacer" />
        <div className="who">
          <div><strong>{me.fullName}</strong><br /><span className="quiet">{me.role.name}{me.isOwner ? ' · Owner' : ''}</span></div>
          <button className="btn" onClick={onSignOut}>Sign out</button>
          <span className="quiet small">Version {appVersion}</span>
        </div>
      </nav>
      <div className="content">
        <header className="topbar">
          <span className="grow" />
          <div className="bell-wrap">
            <button className="icon-btn" aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'} aria-expanded={bellOpen} onClick={() => setBellOpen((o) => !o)}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4zM10 21h4" /></svg>
              {unread > 0 && <span className="badge" aria-hidden="true">{unread}</span>}
            </button>
            {bellOpen && (
              <section className="bell card" aria-label="Notifications">
                <div className="row between">
                  <h2>Notifications</h2>
                  <button className="link" onClick={() => api.post('/api/notifications/read', {}).then(loadNotes)}>Mark all read</button>
                </div>
                {notes.length === 0 && <p className="quiet">Nothing yet.</p>}
                {notes.slice(0, 12).map((n) => (
                  <button key={n.id} className={`note ${n.read ? '' : 'unread'}`} onClick={() => (n.requestId ? goToRequest(n.requestId) : undefined)}>
                    <span>{n.text}</span>
                    <span className="quiet small">{new Date(n.createdAt).toLocaleString()}</span>
                  </button>
                ))}
              </section>
            )}
          </div>
        </header>
        <main className="main">
          {env === 'staging' && <div className="alert alert-warn" role="status"><strong>Staging.</strong> Test data and test copies of the HR system and Predicto. Nothing here reaches real people or payments.</div>}
          {update?.state === 'ready' && (
            <div className="alert alert-good row between" role="status">
              <span>Version {update.detail} is ready. It installs when you restart.</span>
              <button className="btn" onClick={() => bridge.installUpdate()}>Restart now</button>
            </div>
          )}
          {page === 'overview' && <Overview me={me} onOpen={goToRequest} onAll={() => setPage('approvals')} />}
          {page === 'approvals' && <Approvals me={me} initialId={openRequest} />}
          {page === 'audit' && <AuditLog />}
          {page === 'logins' && <Logins me={me} />}
          {(page === 'access' || page === 'settings') && (
            <>
              <h1>{PAGES.find((p) => p.id === page)!.label}</h1>
              <div className="card quiet">This screen is designed in the mockup and its API is in place. The screen arrives in the next build (see docs/NEXT.md).</div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
