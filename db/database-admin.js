import mysql from 'mysql2/promise';
import 'dotenv/config';

/**
 * Reads and validates the database name used by destructive admin commands.
 *
 * @returns {string} The safe database identifier from DB_NAME.
 * @throws {Error} If DB_NAME is missing or contains unsafe characters.
 */
function getDatabaseName() {
  const databaseName = process.env.DB_NAME;

  if (!databaseName || !/^[A-Za-z0-9_]+$/.test(databaseName)) {
    throw new Error('DB_NAME must contain only letters, numbers, and underscores');
  }

  return databaseName;
}

/**
 * Opens a MySQL connection without selecting an application database.
 *
 * @param {(connection: import('mysql2/promise').Connection, databaseName: string) => Promise<void>} callback
 *   The administrative operation to execute.
 * @returns {Promise<void>} Resolves when the operation and cleanup finish.
 */
export async function withDatabaseAdmin(callback) {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_ADMIN_USER || process.env.DB_USER || 'root',
    password: process.env.DB_ADMIN_PASSWORD || process.env.DB_PASSWORD || '',
  });

  try {
    await callback(connection, getDatabaseName());
  } finally {
    await connection.end();
  }
}
