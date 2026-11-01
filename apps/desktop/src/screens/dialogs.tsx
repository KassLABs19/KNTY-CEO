import { useCallback, useState, type FormEvent, type ReactNode } from 'react';
import { ApiRequestError } from '@ceo/shared';
import { api } from '../api';

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

/** A yes/no question before something hard to undo. */
export function ConfirmDialog(props: { title: string; children: ReactNode; confirmLabel: string; danger?: boolean; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="overlay" onKeyDown={(e) => e.key === 'Escape' && props.onCancel()}>
      <div className="card dialog" role="alertdialog" aria-modal="true" aria-labelledby="cf-h" aria-describedby="cf-d">
        <h2 id="cf-h">{props.title}</h2>
        <div id="cf-d" style={{ lineHeight: 1.5 }}>{props.children}</div>
        <div className="row end">
          <button type="button" className="btn" autoFocus onClick={props.onCancel}>Cancel</button>
          <button type="button" className={`btn ${props.danger ? 'btn-danger-solid' : 'btn-primary'}`} onClick={props.onConfirm}>{props.confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

/**
 * `ask()` opens the password dialog and resolves with a short-lived token, or null if the
 * person cancels. Render `dialog` somewhere in the screen.
 */
export function useReauth(name: string) {
  const [resolver, setResolver] = useState<((t: string | null) => void) | null>(null);
  const ask = useCallback(() => new Promise<string | null>((resolve) => setResolver(() => resolve)), []);
  const close = (t: string | null) => {
    resolver?.(t);
    setResolver(null);
  };
  const dialog = resolver ? <ReauthDialog name={name} onCancel={() => close(null)} onConfirmed={(t) => close(t)} /> : null;
  return { ask, dialog };
}
