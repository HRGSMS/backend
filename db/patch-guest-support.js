import { pool } from '../src/config/db.js';

async function runPatch() {
  const connection = await pool.getConnection();

  try {
    console.log('Checking service_usage.status column...');
    const [cols] = await connection.execute(
      `SELECT 1
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'service_usage'
         AND COLUMN_NAME = 'status'`,
    );

    if (!cols.length) {
      await connection.query(
        "ALTER TABLE `service_usage` ADD COLUMN `status` VARCHAR(20) NOT NULL DEFAULT 'Pending'",
      );
      console.log('Added status column to service_usage');
    } else {
      console.log('service_usage.status column already exists');
    }

    console.log('Checking cancellation_policy rows...');
    const [policies] = await connection.execute('SELECT COUNT(*) AS count FROM cancellation_policy');
    if (policies[0].count === 0) {
      await connection.execute(
        `INSERT INTO cancellation_policy (rule_id, minimum_notice_hours, fee_type, fee_value, tax_rate, charge_services)
         VALUES
           (1, 24, 'percentage', 0.5000, 0.1800, 1),
           (2, 72, 'first_night', 1.0000, 0.1800, 1),
           (3, 168, 'fixed', 5000.0000, 0.1800, 0)`,
      );
      console.log('Seeded cancellation_policy rules');
    } else {
      console.log(`cancellation_policy has ${policies[0].count} rules`);
    }

    console.log('Database patch complete.');
  } finally {
    connection.release();
    await pool.end();
  }
}

runPatch().catch((err) => {
  console.error('Patch failed:', err);
  process.exitCode = 1;
});
