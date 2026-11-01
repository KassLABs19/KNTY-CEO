import { useCallback, useEffect, useState } from 'react';
import type { Me } from '@ceo/shared';
import { api } from './api';
import { bridge } from './bridge';
import { ServerSetup } from './screens/ServerSetup';
import { SignIn } from './screens/SignIn';
import { AcceptInvite } from './screens/AcceptInvite';
import { Shell } from './screens/Shell';
import { useIdleSignOut } from './useIdleSignOut';

const IDLE_MINUTES = 30;
type Stage = 'loading' | 'server' | 'signin' | 'invite' | 'app';

export function App() {
  const [stage, setStage] = useState<Stage>('loading');
  const [me, setMe] = useState<Me | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState('');
  const [env, setEnv] = useState('production');
  const [invite, setInvite] = useState<string | null>(null);
  const [prefillEmail, setPrefillEmail] = useState('');

  const enter = useCallback(async () => {
    setMe(await api.me());
    setStage('app');
  }, []);

  const checkInvite = useCallback(async () => {
    const token = await bridge.takeInvite();
    if (token) {
      setInvite(token);
      setStage((s) => (s === 'app' ? s : 'invite'));
    }
  }, []);

  useEffect(() => {
    (async () => {
      setAppVersion(await bridge.appVersion());
      const url = await bridge.getServerUrl();
      if (!url) return setStage('server');
      api.setBaseUrl(url);
      api.version().then((v) => setEnv((v as { env?: string }).env ?? 'production')).catch(() => undefined);
      const token = await bridge.takeInvite();
      if (token) {
        setInvite(token);
        return setStage('invite');
      }
      // Stay signed in between launches if the saved session is still valid.
      if (await api.refresh()) await enter().catch(() => setStage('signin'));
      else setStage('signin');
    })();
    return bridge.onInviteOpened(() => void checkInvite());
  }, [enter, checkInvite]);

  const signOut = useCallback(async (reason?: string) => {
    await api.logout();
    setMe(null);
    setNotice(reason ?? null);
    setStage('signin');
  }, []);

  useIdleSignOut(stage === 'app', IDLE_MINUTES, () => signOut(`You were signed out after ${IDLE_MINUTES} minutes without activity.`));

  if (stage === 'loading') return <div className="center quiet">Starting…</div>;
  if (stage === 'server')
    return <ServerSetup onSaved={(url) => { api.setBaseUrl(url); setStage(invite ? 'invite' : 'signin'); }} />;
  if (stage === 'invite' && invite)
    return (
      <AcceptInvite
        token={invite}
        onDone={(email) => { setInvite(null); setPrefillEmail(email); setNotice('Your password is set. Sign in to continue.'); setStage('signin'); }}
        onCancel={() => { setInvite(null); setStage('signin'); }}
      />
    );
  if (stage === 'signin' || !me)
    return (
      <SignIn
        appVersion={appVersion}
        notice={notice}
        initialEmail={prefillEmail}
        onSignedIn={() => enter()}
        onChangeServer={() => setStage('server')}
        onInviteCode={(code) => { setInvite(code); setStage('invite'); }}
      />
    );
  return <Shell me={me} env={env} appVersion={appVersion} onSignOut={() => signOut()} />;
}
