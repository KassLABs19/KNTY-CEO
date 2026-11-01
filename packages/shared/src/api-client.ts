import type {
  ApiError,
  DecideRequest,
  InviteInfo,
  LoginRequest,
  LoginResponse,
  Me,
  OverviewData,
  ReauthResponse,
  RequestDetail,
  RequestSummary,
  SessionTokens,
  TwoFactorRequest,
  VersionInfo,
} from './api.js';

export class ApiRequestError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export interface TokenStore {
  getAccessToken(): string | null;
  setSession(tokens: SessionTokens): void | Promise<void>;
  getRefreshToken(): Promise<string | null>;
  clear(): void | Promise<void>;
}

export type RequestFilter = 'mine' | 'all' | 'hr' | 'predicto' | 'decided';

/**
 * Small API client for the desktop app. It refreshes the access token once when the
 * server answers 401, and sends the re-entered-password proof when an action needs it.
 */
export class ApiClient {
  constructor(private baseUrl: string, private store: TokenStore) {}

  setBaseUrl(url: string) {
    this.baseUrl = url.replace(/\/+$/, '');
  }

  private async raw<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
    const headers = new Headers(init.headers);
    if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
    const token = this.store.getAccessToken();
    if (token) headers.set('authorization', `Bearer ${token}`);
    const res = await fetch(`${this.baseUrl}${path}`, { ...init, headers });
    if (res.status === 401 && retry && !path.startsWith('/api/auth/')) {
      if (await this.refresh()) return this.raw<T>(path, init, false);
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as Partial<ApiError>;
      throw new ApiRequestError(res.status, body.error ?? 'error', body.message ?? `Request failed (${res.status})`);
    }
    return (res.status === 204 ? undefined : await res.json()) as T;
  }

  async refresh(): Promise<boolean> {
    const refreshToken = await this.store.getRefreshToken();
    if (!refreshToken) return false;
    try {
      const tokens = await this.raw<SessionTokens>('/api/auth/refresh', { method: 'POST', body: JSON.stringify({ refreshToken }) }, false);
      await this.store.setSession(tokens);
      return true;
    } catch {
      await this.store.clear();
      return false;
    }
  }

  version(appVersion?: string) {
    return this.raw<VersionInfo>(`/api/version${appVersion ? `?v=${encodeURIComponent(appVersion)}` : ''}`);
  }

  async login(req: LoginRequest): Promise<LoginResponse> {
    const res = await this.raw<LoginResponse>('/api/auth/login', { method: 'POST', body: JSON.stringify(req) });
    if (res.step === 'done') await this.store.setSession(res.session);
    return res;
  }

  async verify2fa(req: TwoFactorRequest): Promise<void> {
    const tokens = await this.raw<SessionTokens>('/api/auth/2fa', { method: 'POST', body: JSON.stringify(req) });
    await this.store.setSession(tokens);
  }

  async logout(): Promise<void> {
    const refreshToken = await this.store.getRefreshToken();
    await this.raw('/api/auth/logout', { method: 'POST', body: JSON.stringify({ refreshToken }) }).catch(() => undefined);
    await this.store.clear();
  }

  reauth(password: string) {
    return this.raw<ReauthResponse>('/api/auth/reauth', { method: 'POST', body: JSON.stringify({ password }) });
  }

  inviteInfo(token: string) {
    return this.raw<InviteInfo>(`/api/invites/${encodeURIComponent(token)}`);
  }

  acceptInvite(token: string, password: string) {
    return this.raw<void>('/api/invites/accept', { method: 'POST', body: JSON.stringify({ token, password }) });
  }

  me() {
    return this.raw<Me>('/api/me');
  }

  overview() {
    return this.raw<OverviewData>('/api/overview');
  }

  requests(filter: RequestFilter) {
    return this.raw<RequestSummary[]>(`/api/requests?filter=${filter}`);
  }

  request(id: string) {
    return this.raw<RequestDetail>(`/api/requests/${encodeURIComponent(id)}`);
  }

  decide(id: string, body: DecideRequest, reauthToken?: string) {
    const headers: Record<string, string> = reauthToken ? { 'x-reauth-token': reauthToken } : {};
    return this.raw<RequestDetail>(`/api/requests/${encodeURIComponent(id)}/decide`, { method: 'POST', body: JSON.stringify(body), headers });
  }

  bulkApprove(items: { id: string; version: number }[]) {
    return this.raw<{ approved: string[]; failed: { id: string; message: string }[] }>('/api/requests/bulk-approve', {
      method: 'POST',
      body: JSON.stringify({ items }),
    });
  }

  get<T>(path: string) {
    return this.raw<T>(path);
  }

  /** Downloads a file (such as a CSV export) with the signed-in person's token. */
  async download(path: string, retry = true): Promise<Blob> {
    const token = this.store.getAccessToken();
    const res = await fetch(`${this.baseUrl}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
    if (res.status === 401 && retry && (await this.refresh())) return this.download(path, false);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as Partial<ApiError>;
      throw new ApiRequestError(res.status, body.error ?? 'error', body.message ?? `Download failed (${res.status})`);
    }
    return res.blob();
  }

  post<T>(path: string, body: unknown, reauthToken?: string) {
    const headers: Record<string, string> = reauthToken ? { 'x-reauth-token': reauthToken } : {};
    return this.raw<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}), headers });
  }

  put<T>(path: string, body: unknown, reauthToken?: string) {
    const headers: Record<string, string> = reauthToken ? { 'x-reauth-token': reauthToken } : {};
    return this.raw<T>(path, { method: 'PUT', body: JSON.stringify(body ?? {}), headers });
  }
}
