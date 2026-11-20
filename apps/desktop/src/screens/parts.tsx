import { formatMoney, type RequestSummary } from '@ceo/shared';

/** The request type, as a neutral label, so colour is kept for warnings and status only. */
export function TypeLabel({ name }: { name: string }) {
  return (
    <span className="pill sys-label" title={name}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 4h16v16H4zM8 9h8M8 13h8M8 17h5" /></svg>
      <span className="ellip">{name}</span>
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
      <TypeLabel name={r.typeName} />
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
