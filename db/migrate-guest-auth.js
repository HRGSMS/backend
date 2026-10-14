import { fileURLToPath } from 'url';
import { pool } from '../src/config/db.js';

/**
 * Ensures Better Auth users can link to the existing guest.public_id value.
 *
 * Better Auth owns the user table, so this is intentionally idempotent and
 * only runs when that table already exists.
 *
 * @param {import('mysql2/promise').PoolConnection} connection Database connection.
 * @returns {Promise<void>} Resolves after the link column is available.
 */
export async function ensureGuestAuthLink(connection) {
  const [tables] = await connection.execute(
    `SELECT 1
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'user'`,
  );

  if (!tables.length) {
    return;
  }

  const [columns] = await connection.execute(
    `SELECT 1
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'user'
       AND COLUMN_NAME = 'guestPublicId'`,
  );

  if (!columns.length) {
    await connection.query('ALTER TABLE `user` ADD COLUMN `guestPublicId` CHAR(36) NULL');
    console.log('Added Better Auth user.guestPublicId link column');
  }
}

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

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  migrateGuestAuth().catch((error) => {
    console.error('Guest authentication migration failed:', error.message);
    process.exitCode = 1;
  });
}
