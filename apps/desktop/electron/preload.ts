import { contextBridge, ipcRenderer } from 'electron';

type UpdateState = { state: 'downloading' | 'ready' | 'error'; detail?: string };

/** The only things the page can ask the main process for. */
const bridge = {
  appVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),
  getServerUrl: (): Promise<string | null> => ipcRenderer.invoke('settings:getServerUrl'),
  setServerUrl: (url: string): Promise<void> => ipcRenderer.invoke('settings:setServerUrl', url),
  getRefreshToken: (): Promise<string | null> => ipcRenderer.invoke('token:get'),
  setRefreshToken: (token: string | null): Promise<void> => ipcRenderer.invoke('token:set', token),
  /** An invite token from a kntyceo://invite link, if one was opened. Returned once. */
  takeInvite: (): Promise<string | null> => ipcRenderer.invoke('invite:take'),
  onInviteOpened: (cb: () => void): (() => void) => {
    const fn = () => cb();
    ipcRenderer.on('invite:opened', fn);
    return () => {
      ipcRenderer.removeListener('invite:opened', fn);
    };
  },
  installUpdate: (): Promise<void> => ipcRenderer.invoke('update:install'),
  onUpdate: (cb: (u: UpdateState) => void): (() => void) => {
    const fn = (_e: unknown, u: UpdateState) => cb(u);
    ipcRenderer.on('update:state', fn);
    return () => {
      ipcRenderer.removeListener('update:state', fn);
    };
  },
};

contextBridge.exposeInMainWorld('ceo', bridge);
export type CeoBridge = typeof bridge;
