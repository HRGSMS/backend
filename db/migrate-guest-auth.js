import { pool } from '../src/config/db.js';
import { ensureGuestAuthLink } from './init.js';

/**
 * Adds the Better Auth user field used to link guest accounts to hotel guests.
 *
 * Better Auth creates the user table before this script runs. The check keeps
 * the migration safe to rerun without changing existing account data.
 */
async function migrateGuestAuth() {
  const connection = await pool.getConnection();

  try {
    await ensureGuestAuthLink(connection);
  } finally {
    connection.release();
    await pool.end();
  }
}

migrateGuestAuth().catch((error) => {
  console.error('Guest authentication migration failed:', error.message);
  process.exitCode = 1;
});
