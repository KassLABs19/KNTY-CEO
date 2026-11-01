/**
 * Electron main process. It owns the window, stores the server address and the
 * sign-in token (encrypted with Windows' own key store), opens invite links
 * (kntyceo://invite/<token>) and checks for updates. The page runs sandboxed and can
 * only use what preload.ts exposes.
 */
import { app, BrowserWindow, ipcMain, net, protocol, safeStorage, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { pathToFileURL } from 'node:url';

const DEV_URL = process.env.VITE_DEV_SERVER_URL;
const APP_ORIGIN = 'app://ceo';
const LINK_SCHEME = 'kntyceo';

// The packaged page loads from app://ceo/ so the server can allow exactly this origin.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

// Only one copy of the app at a time; a second launch (for example from an invite link) hands over to the first.
if (!app.requestSingleInstanceLock()) app.quit();
if (!DEV_URL) app.setAsDefaultProtocolClient(LINK_SCHEME);

interface Settings {
  serverUrl?: string;
  refreshToken?: string; // encrypted, base64
}
const settingsPath = () => join(app.getPath('userData'), 'settings.json');
function readSettings(): Settings {
  try {
    return existsSync(settingsPath()) ? (JSON.parse(readFileSync(settingsPath(), 'utf8')) as Settings) : {};
  } catch {
    return {};
  }
}
function writeSettings(s: Settings) {
  writeFileSync(settingsPath(), JSON.stringify(s, null, 2), { mode: 0o600 });
}

let win: BrowserWindow | null = null;
let pendingInvite: string | null = null;

/** Finds an invite token in a kntyceo://invite/<token> link among command-line arguments. */
function inviteFrom(argv: string[]): string | null {
  for (const arg of argv) {
    const m = /^kntyceo:\/\/invite\/([A-Za-z0-9_-]{20,200})\/?$/.exec(arg);
    if (m) return m[1]!;
  }
  return null;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#f3eee3',
    title: 'KNTY CEO',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });
  // Links to other sites open in the normal browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(DEV_URL ?? APP_ORIGIN)) e.preventDefault();
  });
  if (DEV_URL) win.loadURL(DEV_URL);
  else win.loadURL(`${APP_ORIGIN}/index.html`);
}

function setupUpdates() {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  const send = (state: string, detail?: string) => win?.webContents.send('update:state', { state, detail });
  autoUpdater.on('update-available', (i) => send('downloading', i.version));
  autoUpdater.on('update-downloaded', (i) => send('ready', i.version));
  autoUpdater.on('error', (e) => send('error', e.message));
  autoUpdater.checkForUpdates().catch(() => undefined);
  setInterval(() => autoUpdater.checkForUpdates().catch(() => undefined), 4 * 3600_000);
}

ipcMain.handle('app:version', () => app.getVersion());
ipcMain.handle('settings:getServerUrl', () => readSettings().serverUrl ?? null);
ipcMain.handle('settings:setServerUrl', (_e, url: string) => {
  const parsed = new URL(url);
  if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('The address must start with https://');
  const s = readSettings();
  writeSettings({ serverUrl: parsed.origin, refreshToken: s.serverUrl === parsed.origin ? s.refreshToken : undefined });
});
ipcMain.handle('token:get', () => {
  const enc = readSettings().refreshToken;
  if (!enc || !safeStorage.isEncryptionAvailable()) return null;
  try {
    return safeStorage.decryptString(Buffer.from(enc, 'base64'));
  } catch {
    return null;
  }
});
ipcMain.handle('token:set', (_e, token: string | null) => {
  const s = readSettings();
  // If the OS key store is unavailable the token is not kept: people simply sign in each time.
  s.refreshToken = token && safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(token).toString('base64') : undefined;
  writeSettings(s);
});
ipcMain.handle('invite:take', () => {
  const t = pendingInvite;
  pendingInvite = null;
  return t;
});
ipcMain.handle('update:install', () => autoUpdater.quitAndInstall());

pendingInvite = inviteFrom(process.argv);

app.whenReady().then(() => {
  const root = join(__dirname, '..', 'dist');
  protocol.handle('app', async (req) => {
    const { pathname } = new URL(req.url);
    const file = normalize(join(root, decodeURIComponent(pathname)));
    if (!file.startsWith(root)) return new Response('Not found', { status: 404 });
    const res = await net.fetch(pathToFileURL(existsSync(file) ? file : join(root, 'index.html')).toString());
    // Strict content policy for the packaged app: only its own scripts may run.
    const headers = new Headers(res.headers);
    headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src https: http:");
    return new Response(res.body, { status: res.status, headers });
  });
  createWindow();
  setupUpdates();
});

app.on('second-instance', (_e, argv) => {
  const token = inviteFrom(argv);
  if (token) {
    pendingInvite = token;
    win?.webContents.send('invite:opened');
  }
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});
app.on('window-all-closed', () => app.quit());
