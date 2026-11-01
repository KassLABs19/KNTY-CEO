import { ApiClient, type SessionTokens, type TokenStore } from '@ceo/shared';
import { bridge } from './bridge';

// The access token stays in memory; the refresh token is kept encrypted by the main process.
let accessToken: string | null = null;

const store: TokenStore = {
  getAccessToken: () => accessToken,
  setSession: async (t: SessionTokens) => {
    accessToken = t.accessToken;
    await bridge.setRefreshToken(t.refreshToken);
  },
  getRefreshToken: () => bridge.getRefreshToken(),
  clear: async () => {
    accessToken = null;
    await bridge.setRefreshToken(null);
  },
};

export const api = new ApiClient('', store);
