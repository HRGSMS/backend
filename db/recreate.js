import { withDatabaseAdmin } from './database-admin.js';

// Rebuild the configured database without connecting to it during the drop.
withDatabaseAdmin(async (connection, databaseName) => {
  await connection.query(`DROP DATABASE IF EXISTS \`${databaseName}\``);
  await connection.query(`CREATE DATABASE \`${databaseName}\``);
  console.log(`Database "${databaseName}" recreated`);
}).catch((error) => {
  console.error('Database recreation failed:', error.message);
  process.exitCode = 1;
});
