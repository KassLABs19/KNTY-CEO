import pg from 'pg';

/**
 * Every company's data lives in the same database, separated by `company_id`.
 * PostgreSQL row-level security enforces it: each query runs inside a transaction
 * that sets `app.company_id`, and the database itself hides other companies' rows,
 * even if application code forgets a WHERE clause.
 */
export type Db = pg.Pool;
export type Tx = pg.PoolClient;

export function createPool(connectionString: string): Db {
  return new pg.Pool({ connectionString, max: 10 });
}

/** Run `fn` with access limited to one company. */
export async function withCompany<T>(db: Db, companyId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.company_id', $1, true)", [companyId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Run `fn` across all companies. Only for sign-in (finding an account by email),
 * migrations and seeding. Never use it for normal requests.
 */
export async function withSystem<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.bypass_rls', 'on', true)");
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
