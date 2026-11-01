import { formatMoney, type RequestSummary } from '@ceo/shared';

const SYSTEMS = {
  hr: { name: 'HR system', icon: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21c0-4 3-6 7-6s7 2 7 6' },
  predicto: { name: 'Predicto', icon: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7l4 3-1.5 4.5h-5L8 10z' },
};

/** Neutral label with an icon, so colour is kept for warnings and status only. */
export function SystemLabel({ system }: { system: 'hr' | 'predicto' }) {
  const s = SYSTEMS[system];
  return (
    <span className="pill sys-label">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={s.icon} /></svg>
      {s.name}
    </span>
  );
}

export const STATUS: Record<string, [string, string]> = {
  pending: ['Pending', ''],
  approved: ['Approved', 'pill-good'],
  rejected: ['Rejected', 'pill-bad'],
  returned: ['Sent back', 'pill-info'],
  cancelled: ['Withdrawn', ''],
};

export function ageText(h: number) {
  if (h < 1) return 'just now';
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

export function WaitingRow({ r, onOpen }: { r: RequestSummary; onOpen: () => void }) {
  return (
    <button className="req-row" onClick={onOpen}>
      <SystemLabel system={r.system} />
      <span className="grow col">
        <span className="title">{r.title}</span>
        <span className="quiet small">{r.subtitle}{r.onBehalfOf ? ` · for ${r.onBehalfOf}` : ''} · {ageText(r.ageHours)}</span>
      </span>
      {r.changedUpstream && <span className="pill pill-warn">Changed upstream</span>}
      {r.overdue && <span className="pill pill-warn">Waiting too long</span>}
      <span className="mono amount">{r.money ? formatMoney(r.money) : '—'}</span>
    </button>
  );
}
