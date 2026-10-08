import { initializeDatabase } from './init.js';

// Run initialization as a CLI command and return a non-zero exit code on failure.
initializeDatabase().catch((error) => {
  console.error('Database initialization failed:', error.message);
  process.exitCode = 1;
});
