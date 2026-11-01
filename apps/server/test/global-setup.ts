/**
 * Gives the tests an empty PostgreSQL database.
 * - In CI, set TEST_DATABASE_URL (a non-superuser that owns an empty database).
 * - Locally, if PostgreSQL is installed, a throwaway server is started in .tmp-pg/
 *   and removed afterwards.
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, chownSync } from 'node:fs';
import { join, resolve } from 'node:path';

let server: ChildProcess | undefined;
let stop: (() => void) | undefined;
const dir = resolve('.tmp-pg');
const port = 54329;

function pgBin(name: string): string {
  const base = '/usr/lib/postgresql';
  if (existsSync(base)) {
    const v = readdirSync(base).sort().reverse()[0];
    if (v) return join(base, v, 'bin', name);
  }
  return name;
}

export async function setup({ provide }: { provide: (k: string, v: string) => void }) {
  if (process.env.TEST_DATABASE_URL) {
    provide('databaseUrl', process.env.TEST_DATABASE_URL);
    return;
  }
  const asRoot = process.getuid?.() === 0;
  const run = (cmd: string, args: string[]) =>
    asRoot ? execFileSync('runuser', ['-u', 'postgres', '--', cmd, ...args], { stdio: 'pipe' }) : execFileSync(cmd, args, { stdio: 'pipe' });

  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir);
  if (asRoot) chownSync(dir, 102, 104);
  run(pgBin('initdb'), ['-D', join(dir, 'data'), '-U', 'postgres', '--auth=trust', '-E', 'UTF8']);
  const args = ['-D', join(dir, 'data'), '-p', String(port), '-k', dir, '-c', 'listen_addresses=127.0.0.1'];
  stop = () => run(pgBin('pg_ctl'), ['-D', join(dir, 'data'), '-m', 'fast', '-w', 'stop']) as unknown as void;
  server = asRoot ? spawn('runuser', ['-u', 'postgres', '--', pgBin('postgres'), ...args], { stdio: 'ignore', detached: true }) : spawn(pgBin('postgres'), args, { stdio: 'ignore', detached: true });

  const psql = (sql: string) => run(pgBin('psql'), ['-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', sql]);
  for (let i = 0; ; i++) {
    try { psql('SELECT 1'); break; } catch { if (i > 50) throw new Error('Test PostgreSQL did not start'); await new Promise((r) => setTimeout(r, 200)); }
  }
  // The app must connect as an ordinary user: superusers ignore row-level security.
  psql("CREATE ROLE hr_app LOGIN PASSWORD 'hr_app'");
  psql('CREATE DATABASE hr_test OWNER hr_app');
  provide('databaseUrl', `postgres://hr_app:hr_app@127.0.0.1:${port}/hr_test`);
}

export async function teardown() {
  if (stop) {
    try { stop(); } catch { server?.kill('SIGKILL'); }
  }
  server?.unref();
  rmSync(dir, { recursive: true, force: true });
}
