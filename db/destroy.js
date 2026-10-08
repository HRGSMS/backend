import { withDatabaseAdmin } from './database-admin.js';

// Drop only the database selected by the validated DB_NAME environment variable.
withDatabaseAdmin(async (connection, databaseName) => {
  await connection.query(`DROP DATABASE IF EXISTS \`${databaseName}\``);
  console.log(`Database "${databaseName}" destroyed`);
}).catch((error) => {
  console.error('Database destruction failed:', error.message);
  process.exitCode = 1;
});
