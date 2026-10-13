import { pool } from '../src/config/db.js';

/**
 * Adds the Better Auth user field used to link guest accounts to hotel guests.
 *
 * Better Auth creates the user table before this script runs. The check keeps
 * the migration safe to rerun without changing existing account data.
 */
async function migrateGuestAuth() {
  const connection = await pool.getConnection();

  try {
    const [columns] = await connection.execute(
      `SELECT 1
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'user'
         AND COLUMN_NAME = 'guestPublicId'`,
    );

    if (!columns.length) {
      await connection.query(
        'ALTER TABLE `user` ADD COLUMN `guestPublicId` CHAR(36) NULL',
      );
      console.log('Added Better Auth guestPublicId field');
    }
  } finally {
    connection.release();
    await pool.end();
  }
}

migrateGuestAuth().catch((error) => {
  console.error('Guest authentication migration failed:', error.message);
  process.exitCode = 1;
});
