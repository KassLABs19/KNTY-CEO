import type { CeoBridge } from '../electron/preload';

declare global {
  interface Window {
    ceo?: CeoBridge;
  }
}

/**
 * Inside the desktop app, window.ceo comes from preload.ts. If the page is opened in an
 * ordinary browser during development, a stand-in keeps things working (nothing is saved).
 */
let devServerUrl: string | null = 'http://localhost:8090';
export const bridge: CeoBridge = window.ceo ?? {
  appVersion: async () => '0.1.0',
  getServerUrl: async () => devServerUrl,
  setServerUrl: async (u: string) => {
    devServerUrl = u;
  },
  getRefreshToken: async () => null,
  setRefreshToken: async () => undefined,
  takeInvite: async () => null,
  onInviteOpened: () => () => undefined,
  installUpdate: async () => undefined,
  onUpdate: () => () => undefined,
};
