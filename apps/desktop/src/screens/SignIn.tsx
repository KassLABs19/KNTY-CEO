import { useEffect, useState, type FormEvent } from 'react';
import QRCode from 'qrcode';
import { ApiRequestError } from '@ceo/shared';
import { api } from '../api';

type Step = { kind: 'password' } | { kind: 'code'; challengeToken: string } | { kind: 'setup'; challengeToken: string; otpauthUrl: string; secret: string };

export function SignIn(props: {
  appVersion: string;
  notice: string | null;
  initialEmail: string;
  onSignedIn: () => void;
  onChangeServer: () => void;
  onInviteCode: (code: string) => void;
}) {
  const [step, setStep] = useState<Step>({ kind: 'password' });
  const [email, setEmail] = useState(props.initialEmail);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [qr, setQr] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [invite, setInvite] = useState('');

  useEffect(() => {
    if (step.kind === 'setup') QRCode.toDataURL(step.otpauthUrl, { margin: 1, width: 180 }).then(setQr);
  }, [step]);

  const fail = (err: unknown) => setError(err instanceof ApiRequestError ? err.message : 'Can’t reach the server. Check your connection.');

  async function submitPassword(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.login({ email, password, appVersion: props.appVersion });
      if (res.step === 'done') props.onSignedIn();
      else if (res.step === '2fa') setStep({ kind: 'code', challengeToken: res.challengeToken });
      else setStep({ kind: 'setup', challengeToken: res.challengeToken, otpauthUrl: res.otpauthUrl, secret: res.secret });
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
      setPassword('');
    }
  }

  async function submitCode(e: FormEvent) {
    e.preventDefault();
    if (step.kind === 'password') return;
    setBusy(true);
    setError(null);
    try {
      await api.verify2fa({ challengeToken: step.challengeToken, code });
      props.onSignedIn();
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === 'challenge_expired') setStep({ kind: 'password' });
      fail(err);
    } finally {
      setBusy(false);
      setCode('');
    }
  }

  if (step.kind !== 'password') {
    return (
      <div className="center">
        <form className="card panel" onSubmit={submitCode}>
          <h1>{step.kind === 'setup' ? 'Set up two-step sign-in' : 'Enter your code'}</h1>
          {step.kind === 'setup' ? (
            <>
              <p className="quiet" style={{ margin: 0 }}>Your role needs a second step. Scan this with an authenticator app (such as Microsoft Authenticator or Google Authenticator), then enter the 6-digit code it shows.</p>
              {qr && <img className="qr" src={qr} alt="QR code for your authenticator app" width={180} height={180} />}
              <div className="field"><span className="label">Or type this key</span><div className="code">{step.secret}</div></div>
            </>
          ) : (
            <p className="quiet" style={{ margin: 0 }}>Open your authenticator app and enter the 6-digit code for KNTY CEO.</p>
          )}
          {error && <div className="alert alert-bad" role="alert">{error}</div>}
          <div className="field">
            <label htmlFor="code">6-digit code</label>
            <input id="code" className="input mono" inputMode="numeric" autoComplete="one-time-code" maxLength={7} required autoFocus value={code} onChange={(e) => setCode(e.target.value)} />
          </div>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Checking…' : 'Continue'}</button>
          <button type="button" className="btn" onClick={() => { setStep({ kind: 'password' }); setError(null); }}>Back</button>
        </form>
      </div>
    );
  }

  return (
    <div className="center">
      <form className="card panel" onSubmit={submitPassword}>
        <div className="brand"><span className="mark" aria-hidden="true">CEO</span><span>KNTY CEO</span></div>
        <h1>Sign in</h1>
        {props.notice && <div className="alert alert-info" role="status">{props.notice}</div>}
        {error && <div className="alert alert-bad" role="alert">{error}</div>}
        <div className="field">
          <label htmlFor="email">Work email</label>
          <input id="email" className="input" type="email" autoComplete="username" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input id="password" className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <p className="quiet small">There’s no self sign-up. Account owners create logins and send invite links.</p>
        {inviteOpen ? (
          <div className="field">
            <label htmlFor="invite">Invite code or link</label>
            <div className="row">
              <input id="invite" className="input grow" value={invite} onChange={(e) => setInvite(e.target.value)} placeholder="kntyceo://invite/…" />
              <button type="button" className="btn" onClick={() => { const c = invite.trim().replace(/^kntyceo:\/\/invite\//, '').replace(/\/$/, ''); if (c) props.onInviteCode(c); }}>Continue</button>
            </div>
          </div>
        ) : (
          <button type="button" className="link" onClick={() => setInviteOpen(true)}>I have an invite</button>
        )}
        <p className="quiet small">
          Version {props.appVersion} · <button type="button" className="link" onClick={props.onChangeServer}>Change server</button>
        </p>
      </form>
    </div>
  );
}
