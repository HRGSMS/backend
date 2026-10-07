import { pool } from '../src/config/db.js';

const tableDefinitions = [
  `
    CREATE TABLE IF NOT EXISTS \`guest\` (
      \`guest_id\` INT NOT NULL,
      \`first_name\` VARCHAR(20),
      \`last_name\` VARCHAR(20),
      \`email\` VARCHAR(30),
      \`phone_number\` VARCHAR(20),
      PRIMARY KEY (\`guest_id\`)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS \`branch\` (
      \`branch_id\` INT NOT NULL,
      \`name\` VARCHAR(100),
      \`location_city\` VARCHAR(100),
      PRIMARY KEY (\`branch_id\`)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS \`tax_rate\` (
      \`tax_id\` INT NOT NULL,
      \`rate\` DECIMAL(10, 2),
      \`branch_id\` INT NOT NULL,
      PRIMARY KEY (\`tax_id\`),
      FOREIGN KEY (\`branch_id\`) REFERENCES \`branch\`(\`branch_id\`)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS \`booking\` (
      \`booking_id\` INT NOT NULL,
      \`guest_id\` INT NOT NULL,
      \`booking_time\` DATETIME,
      \`check_in_time\` DATETIME,
      \`check_out_time\` DATETIME,
      \`cancellation_time\` DATETIME,
      \`booking_status\` VARCHAR(15),
      \`payment_status\` VARCHAR(20),
      \`total_charge\` DECIMAL(10, 2),
      \`outstanding_amount\` DECIMAL(10, 2),
      \`tax_id\` INT,
      \`total_tax_amount\` DECIMAL(10, 2),
      PRIMARY KEY (\`booking_id\`),
      FOREIGN KEY (\`guest_id\`) REFERENCES \`guest\`(\`guest_id\`),
      FOREIGN KEY (\`tax_id\`) REFERENCES \`tax_rate\`(\`tax_id\`)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS \`payment\` (
      \`payment_id\` INT NOT NULL,
      \`booking_id\` INT NOT NULL,
      \`payment_date\` DATETIME,
      \`payment_method\` VARCHAR(20),
      \`amount\` DECIMAL(10, 2),
      PRIMARY KEY (\`payment_id\`),
      FOREIGN KEY (\`booking_id\`) REFERENCES \`booking\`(\`booking_id\`)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS \`room_type\` (
      \`room_type_id\` INT NOT NULL,
      \`type_name\` VARCHAR(20),
      \`room_type_description\` VARCHAR(100),
      \`capacity\` INT,
      \`daily_rate\` DECIMAL(10, 2),
      \`rate_update_time\` DATETIME,
      PRIMARY KEY (\`room_type_id\`)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS \`room\` (
      \`room_id\` INT NOT NULL,
      \`branch_id\` INT NOT NULL,
      \`room_type_id\` INT NOT NULL,
      \`room_number\` VARCHAR(5),
      \`current_status\` BOOLEAN,
      \`booking_availability\` BOOLEAN,
      PRIMARY KEY (\`room_id\`),
      FOREIGN KEY (\`room_type_id\`) REFERENCES \`room_type\`(\`room_type_id\`),
      FOREIGN KEY (\`branch_id\`) REFERENCES \`branch\`(\`branch_id\`)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS \`service_catalogue\` (
      \`service_id\` INT NOT NULL,
      \`service_name\` VARCHAR(20),
      \`service_description\` VARCHAR(100),
      \`current_price\` DECIMAL(10, 2),
      \`price_update_time\` DATETIME,
      \`tax_id\` INT,
      PRIMARY KEY (\`service_id\`),
      FOREIGN KEY (\`tax_id\`) REFERENCES \`tax_rate\`(\`tax_id\`)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS \`amenity\` (
      \`amenity_id\` INT NOT NULL,
      \`amenity_name\` VARCHAR(20),
      \`amenity_description\` VARCHAR(50),
      PRIMARY KEY (\`amenity_id\`)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS \`room_amenity\` (
      \`amenity_id\` INT NOT NULL,
      \`room_type_id\` INT NOT NULL,
      PRIMARY KEY (\`amenity_id\`, \`room_type_id\`),
      FOREIGN KEY (\`room_type_id\`) REFERENCES \`room_type\`(\`room_type_id\`),
      FOREIGN KEY (\`amenity_id\`) REFERENCES \`amenity\`(\`amenity_id\`)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS \`booking_room\` (
      \`booking_id\` INT NOT NULL,
      \`room_id\` INT NOT NULL,
      \`price_at_booking\` DECIMAL(10, 2),
      PRIMARY KEY (\`booking_id\`, \`room_id\`),
      FOREIGN KEY (\`room_id\`) REFERENCES \`room\`(\`room_id\`),
      FOREIGN KEY (\`booking_id\`) REFERENCES \`booking\`(\`booking_id\`)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS \`service_usage\` (
      \`usage_id\` INT NOT NULL,
      \`booking_id\` INT NOT NULL,
      \`service_id\` INT NOT NULL,
      \`room_id\` INT NOT NULL,
      \`usage_time\` DATETIME,
      \`quantity\` INT,
      \`price_at_usage\` DECIMAL(10, 2),
      PRIMARY KEY (\`usage_id\`),
      FOREIGN KEY (\`room_id\`) REFERENCES \`room\`(\`room_id\`),
      FOREIGN KEY (\`booking_id\`) REFERENCES \`booking\`(\`booking_id\`),
      FOREIGN KEY (\`service_id\`) REFERENCES \`service_catalogue\`(\`service_id\`)
    )
  `,
];

/**
 * Creates the application tables in foreign-key dependency order.
 *
 * Existing tables are preserved because each statement uses
 * CREATE TABLE IF NOT EXISTS.
 *
 * @returns {Promise<void>} Resolves after every table has been created.
 */
export async function initializeDatabase() {
  const connection = await pool.getConnection();

  try {
    for (const definition of tableDefinitions) {
      await connection.query(definition);
    }

    console.log('Database tables initialized');
  } finally {
    connection.release();
    await pool.end();
  }
}
