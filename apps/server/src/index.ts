import { loadEnvFile } from './env.js';
import { loadConfig } from './config.js';
import { createPool } from './db.js';
import { migrate } from './migrate.js';
import { buildApp } from './app.js';
import { startJobs } from './jobs.js';
import { loadLicence, type LicenceState } from './licence.js';

loadEnvFile();
const config = loadConfig();
const db = createPool(config.DATABASE_URL);

await migrate(db);

let licence: LicenceState = await loadLicence(config.HOSTING_MODE, config.LICENCE_PATH, config.LICENCE_PUBLIC_KEY);
// Re-read the licence every hour so a renewal takes effect without a restart.
setInterval(async () => {
  licence = await loadLicence(config.HOSTING_MODE, config.LICENCE_PATH, config.LICENCE_PUBLIC_KEY);
}, 3600_000).unref();

const app = await buildApp(db, config, () => licence);
if (licence.status === 'invalid' || licence.status === 'expired') {
  app.log.warn({ licence }, 'Licence problem: the server is running read-only');
}
const stopJobs = config.RUN_JOBS === 'on' ? startJobs(db, (o, m) => app.log.error(o, m)) : () => undefined;

const shutdown = async () => {
  stopJobs();
  await app.close();
  await db.end();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: config.PORT, host: '0.0.0.0' });
