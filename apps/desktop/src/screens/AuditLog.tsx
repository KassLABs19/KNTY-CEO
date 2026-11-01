import { useEffect, useState } from 'react';
import { api } from '../api';

interface Entry {
  id: number;
  createdAt: string;
  action: string;
  category: string;
  targetType: string | null;
  targetId: string | null;
  traceId: string | null;
  actor: string;
  onBehalfOf: string | null;
}

const CATEGORIES = [
  ['', 'All'], ['approvals', 'Approvals'], ['access', 'Access changes'], ['logins', 'Logins'], ['security', 'Security'],
  ['sensitive', 'Sensitive views & exports'], ['sync', 'System sync'], ['settings', 'Settings'],
] as const;

export function AuditLog() {
  const [category, setCategory] = useState('');
  const [rows, setRows] = useState<Entry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exported, setExported] = useState(false);

  useEffect(() => {
    setRows(null);
    api.get<Entry[]>(`/api/audit?limit=100${category ? `&category=${category}` : ''}`).then(setRows).catch((e: Error) => setError(e.message));
  }, [category]);

  async function exportCsv() {
    // The file is marked with who downloaded it and when; the download is logged.
    let blob: Blob;
    try {
      blob = await api.download(`/api/audit/export${category ? `?category=${category}` : ''}`);
    } catch (e) {
      return setError((e as Error).message);
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'audit-log.csv';
    a.click();
    URL.revokeObjectURL(url);
    setExported(true);
  }

  return (
    <>
      <div className="row between wrap">
        <div>
          <span className="quiet small">Every decision, access change, sync and sensitive view. Entries can’t be edited or deleted.</span>
          <h1>Audit log</h1>
        </div>
        <button className="btn" onClick={exportCsv}>Export CSV</button>
      </div>
      {exported && <div className="alert alert-good" role="status">Exported. The file carries your name and the time, and the export is in the log.</div>}
      <div className="chips" role="group" aria-label="Filter entries">
        {CATEGORIES.map(([id, label]) => <button key={id} className="chip" aria-pressed={category === id} onClick={() => setCategory(id)}>{label}</button>)}
      </div>
      {error && <div className="alert alert-bad" role="alert">{error}</div>}
      <section className="card flush">
        <div className="scroll-x">
          <table>
            <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Target</th><th>Trace</th></tr></thead>
            <tbody>
              {rows?.map((r) => (
                <tr key={r.id}>
                  <td className="mono small">{new Date(r.createdAt).toLocaleString()}</td>
                  <td>{r.actor}{r.onBehalfOf && <><br /><span className="quiet small">for {r.onBehalfOf}</span></>}</td>
                  <td>{r.action}<br /><span className="quiet small">{r.category}</span></td>
                  <td>{[r.targetType, r.targetId].filter(Boolean).join(' ')}</td>
                  <td className="mono small">{r.traceId ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows === null && <p className="quiet pad">Loading…</p>}
        </div>
      </section>
    </>
  );
}
