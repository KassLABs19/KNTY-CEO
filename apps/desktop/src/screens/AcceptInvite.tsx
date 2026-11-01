import { useEffect, useState, type FormEvent } from 'react';
import { ApiRequestError, type InviteInfo } from '@ceo/shared';
import { api } from '../api';

/** Opened from an invite link: the person sets their own password. */
export function AcceptInvite({ token, onDone, onCancel }: { token: string; onDone: (email: string) => void; onCancel: () => void }) {
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.inviteInfo(token).then(setInfo).catch((e: Error) => setError(e.message));
  }, [token]);

  const checks: [string, boolean][] = [
    ['At least 10 characters', pw.length >= 10],
    ['Letters and numbers', /[A-Za-z]/.test(pw) && /\d/.test(pw)],
    ['Both passwords match', pw.length > 0 && pw === pw2],
  ];
  const ready = checks.every(([, ok]) => ok);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready || !info) return;
    setBusy(true);
    setError(null);
    try {
      await api.acceptInvite(token, pw);
      onDone(info.email);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Can’t reach the server. Check your connection.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center">
      <form className="card panel" onSubmit={submit}>
        {!info && !error && <p className="quiet">Checking your invite…</p>}
        {error && !info && (
          <>
            <h1>Invite not valid</h1>
            <div className="alert alert-bad" role="alert">{error}</div>
            <button type="button" className="btn" onClick={onCancel}>Back to sign in</button>
          </>
        )}
        {info && (
          <>
            <h1>Welcome, {info.fullName.split(' ')[0]}</h1>
            <p style={{ margin: 0, lineHeight: 1.5 }}>You’ve been invited as <strong>{info.roleName}</strong>. Set a password to finish setting up your account.</p>
            <div className="field"><span className="label">Work email</span><div className="readonly">{info.email}</div></div>
            {error && <div className="alert alert-bad" role="alert">{error}</div>}
            <div className="field">
              <label htmlFor="pw">New password</label>
              <input id="pw" className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
            </div>
            <ul className="checks">
              {checks.map(([text, ok]) => <li key={text} className={ok ? 'ok' : ''}>{ok ? '✓' : '○'} {text}</li>)}
            </ul>
            <div className="field">
              <label htmlFor="pw2">Confirm password</label>
              <input id="pw2" className="input" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
            </div>
            <button className="btn btn-primary" disabled={!ready || busy}>{busy ? 'Saving…' : 'Set password'}</button>
            {info.requires2fa && <p className="quiet small">Your role needs two-step sign-in. You’ll connect an authenticator app the first time you sign in.</p>}
            <p className="quiet small">This link works once and expires 48 hours after it was sent.</p>
          </>
        )}
      </form>
    </div>
  );
}
