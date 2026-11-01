import { useState, type FormEvent } from 'react';
import { ApiClient } from '@ceo/shared';
import { bridge } from '../bridge';

/** First launch: where is this company's KNTY CEO server? (The vendor's cloud or their own.) */
export function ServerSetup({ onSaved }: { onSaved: (url: string) => void }) {
  const [url, setUrl] = useState('https://');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const origin = new URL(url.trim()).origin;
      const probe = new ApiClient(origin, { getAccessToken: () => null, setSession: () => undefined, getRefreshToken: async () => null, clear: () => undefined });
      const info = await probe.version(await bridge.appVersion());
      if (!info.supported) {
        setError(`This server needs app version ${info.minDesktopVersion} or later. Please install the latest version.`);
        return;
      }
      await bridge.setServerUrl(origin);
      onSaved(origin);
    } catch {
      setError('Couldn’t reach a KNTY CEO server at that address. Check it with your IT team.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center">
      <form className="card panel" onSubmit={submit}>
        <h1>Connect to your company</h1>
        <p className="quiet" style={{ margin: 0 }}>Enter the server address your IT team or account owner gave you. You only do this once.</p>
        {error && <div className="alert alert-bad" role="alert">{error}</div>}
        <div className="field">
          <label htmlFor="url">Server address</label>
          <input id="url" className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://ceo.yourcompany.com" required />
        </div>
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Checking…' : 'Connect'}</button>
      </form>
    </div>
  );
}
