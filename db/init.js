import { pool } from '../src/config/db.js';
import { installTriggers } from './triggers.js';

const tableDefinitions = [
  `
    CREATE TABLE IF NOT EXISTS \`guest\` (
      \`guest_id\` INT NOT NULL,
      \`public_id\` CHAR(36) NOT NULL UNIQUE DEFAULT (UUID()),
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
      \`public_id\` CHAR(36) NOT NULL UNIQUE DEFAULT (UUID()),
      \`name\` VARCHAR(100),
      \`location_city\` VARCHAR(100),
      PRIMARY KEY (\`branch_id\`)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS \`tax_rate\` (
      \`tax_id\` INT NOT NULL,
      \`public_id\` CHAR(36) NOT NULL UNIQUE DEFAULT (UUID()),
      \`rate\` DECIMAL(10, 2),
      \`branch_id\` INT NOT NULL,
      PRIMARY KEY (\`tax_id\`),
      FOREIGN KEY (\`branch_id\`) REFERENCES \`branch\`(\`branch_id\`)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS \`booking\` (
      \`booking_id\` INT NOT NULL,
      \`public_id\` CHAR(36) NOT NULL UNIQUE DEFAULT (UUID()),
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
      \`tax_rate_at_booking\` DECIMAL(10, 4),
      \`total_tax_amount\` DECIMAL(10, 2),
      \`credit_amount\` DECIMAL(10, 2) NOT NULL DEFAULT 0,
      \`cancellation_fee\` DECIMAL(10, 2) NOT NULL DEFAULT 0,
      \`cancellation_tax_amount\` DECIMAL(10, 2) NOT NULL DEFAULT 0,
      \`cancellation_charge_services\` BOOLEAN NOT NULL DEFAULT FALSE,
      \`cancellation_rule_id\` INT,
      PRIMARY KEY (\`booking_id\`),
      FOREIGN KEY (\`guest_id\`) REFERENCES \`guest\`(\`guest_id\`),
      FOREIGN KEY (\`tax_id\`) REFERENCES \`tax_rate\`(\`tax_id\`)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS \`payment\` (
      \`payment_id\` INT NOT NULL,
      \`public_id\` CHAR(36) NOT NULL UNIQUE DEFAULT (UUID()),
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
      \`public_id\` CHAR(36) NOT NULL UNIQUE DEFAULT (UUID()),
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
      \`public_id\` CHAR(36) NOT NULL UNIQUE DEFAULT (UUID()),
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
      \`public_id\` CHAR(36) NOT NULL UNIQUE DEFAULT (UUID()),
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
      \`public_id\` CHAR(36) NOT NULL UNIQUE DEFAULT (UUID()),
      \`amenity_name\` VARCHAR(20),
      \`amenity_description\` VARCHAR(50),
      PRIMARY KEY (\`amenity_id\`)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS \`room_amenity\` (
      \`public_id\` CHAR(36) NOT NULL UNIQUE DEFAULT (UUID()),
      \`amenity_id\` INT NOT NULL,
      \`room_type_id\` INT NOT NULL,
      PRIMARY KEY (\`amenity_id\`, \`room_type_id\`),
      FOREIGN KEY (\`room_type_id\`) REFERENCES \`room_type\`(\`room_type_id\`),
      FOREIGN KEY (\`amenity_id\`) REFERENCES \`amenity\`(\`amenity_id\`)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS \`booking_room\` (
      \`public_id\` CHAR(36) NOT NULL UNIQUE DEFAULT (UUID()),
      \`booking_id\` INT NOT NULL,
      \`room_id\` INT NOT NULL,
      \`nightly_rate_at_booking\` DECIMAL(10, 2),
      \`price_at_booking\` DECIMAL(10, 2),
      PRIMARY KEY (\`booking_id\`, \`room_id\`),
      FOREIGN KEY (\`room_id\`) REFERENCES \`room\`(\`room_id\`),
      FOREIGN KEY (\`booking_id\`) REFERENCES \`booking\`(\`booking_id\`)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS \`service_usage\` (
      \`usage_id\` INT NOT NULL,
      \`public_id\` CHAR(36) NOT NULL UNIQUE DEFAULT (UUID()),
      \`booking_id\` INT NOT NULL,
      \`service_id\` INT NOT NULL,
      \`room_id\` INT NOT NULL,
      \`usage_time\` DATETIME,
      \`quantity\` INT,
      \`price_at_usage\` DECIMAL(10, 2),
      \`tax_rate_at_usage\` DECIMAL(10, 4),
      \`status\` VARCHAR(20) NOT NULL DEFAULT 'Pending',
      PRIMARY KEY (\`usage_id\`),
      FOREIGN KEY (\`room_id\`) REFERENCES \`room\`(\`room_id\`),
      FOREIGN KEY (\`booking_id\`) REFERENCES \`booking\`(\`booking_id\`),
      FOREIGN KEY (\`service_id\`) REFERENCES \`service_catalogue\`(\`service_id\`)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS \`cancellation_policy\` (
      \`rule_id\` INT PRIMARY KEY AUTO_INCREMENT,
      \`minimum_notice_hours\` INT NOT NULL UNIQUE,
      \`fee_type\` ENUM('percentage', 'first_night', 'fixed') NOT NULL,
      \`fee_value\` DECIMAL(12, 4) NOT NULL,
      \`tax_rate\` DECIMAL(10, 4) NOT NULL,
      \`charge_services\` BOOLEAN NOT NULL,
      CHECK (\`minimum_notice_hours\` >= 0),
      CHECK (\`fee_value\` >= 0),
      CHECK (\`fee_type\` <> 'percentage' OR \`fee_value\` <= 1),
      CHECK (\`tax_rate\` BETWEEN 0 AND 1),
      CHECK (\`charge_services\` IN (0, 1))
    ) ENGINE=InnoDB
  `,
  `
    CREATE TABLE IF NOT EXISTS \`notification_outbox\` (
      \`event_id\` BIGINT PRIMARY KEY AUTO_INCREMENT,
      \`event_key\` VARCHAR(100) NOT NULL UNIQUE,
      \`booking_id\` INT NOT NULL,
      \`topic\` VARCHAR(50) NOT NULL,
      \`channel\` ENUM('email', 'socket') NOT NULL,
      \`available_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \`attempts\` INT NOT NULL DEFAULT 0,
      \`delivered_at\` DATETIME NULL,
      \`last_error\` VARCHAR(255) NULL,
      FOREIGN KEY (\`booking_id\`) REFERENCES \`booking\`(\`booking_id\`),
      INDEX \`pending_notifications\` (\`delivered_at\`, \`available_at\`)
    ) ENGINE=InnoDB
  `,
];

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

const viewDefinitions = [
  `
    CREATE OR REPLACE VIEW \`report_occupancy\` AS
    SELECT
      r.public_id AS room_public_id,
      r.room_id,
      r.room_number,
      b.public_id AS branch_public_id,
      b.branch_id,
      b.name AS branch_name,
      rt.type_name,
      bk.booking_id,
      bk.public_id AS booking_public_id,
      bk.check_in_time,
      bk.check_out_time,
      bk.booking_status
    FROM room r
    JOIN branch b ON b.branch_id = r.branch_id
    JOIN room_type rt ON rt.room_type_id = r.room_type_id
    LEFT JOIN booking_room br ON br.room_id = r.room_id
    LEFT JOIN booking bk ON bk.booking_id = br.booking_id
  `,
  `
    CREATE OR REPLACE VIEW \`report_guest_billing\` AS
    SELECT
      b.booking_id,
      b.public_id AS booking_public_id,
      b.guest_id,
      g.public_id AS guest_public_id,
      CONCAT(g.first_name, ' ', g.last_name) AS guest_name,
      b.booking_status,
      b.payment_status,
      b.total_charge,
      COALESCE(SUM(p.amount), 0) AS paid_amount,
      b.total_charge - COALESCE(SUM(p.amount), 0) AS calculated_outstanding_amount
    FROM booking b
    JOIN guest g ON g.guest_id = b.guest_id
    LEFT JOIN payment p ON p.booking_id = b.booking_id
    GROUP BY
      b.booking_id,
      b.public_id,
      b.guest_id,
      g.public_id,
      g.first_name,
      g.last_name,
      b.booking_status,
      b.payment_status,
      b.total_charge
  `,
  `
    CREATE OR REPLACE VIEW \`report_service_usage\` AS
    SELECT
      su.usage_id,
      su.public_id AS usage_public_id,
      su.usage_time,
      su.booking_id,
      b.public_id AS booking_public_id,
      su.room_id,
      r.public_id AS room_public_id,
      r.room_number,
      su.service_id,
      sc.public_id AS service_public_id,
      sc.service_name,
      su.quantity,
      su.price_at_usage,
      su.quantity * su.price_at_usage AS line_total
    FROM service_usage su
    JOIN booking b ON b.booking_id = su.booking_id
    JOIN room r ON r.room_id = su.room_id
    JOIN service_catalogue sc ON sc.service_id = su.service_id
  `,
  `
    CREATE OR REPLACE VIEW \`report_revenue\` AS
    SELECT DISTINCT
      br.public_id AS branch_public_id,
      br.branch_id,
      br.name AS branch_name,
      b.booking_id,
      b.public_id AS booking_public_id,
      b.check_in_time,
      b.check_out_time,
      b.total_charge AS room_and_tax_revenue,
      COALESCE((
        SELECT SUM(su.quantity * su.price_at_usage)
        FROM service_usage su
        WHERE su.booking_id = b.booking_id
      ), 0) AS service_revenue
    FROM branch br
    JOIN room r ON r.branch_id = br.branch_id
    JOIN booking_room booking_room_for_branch
      ON booking_room_for_branch.room_id = r.room_id
    JOIN booking b ON b.booking_id = booking_room_for_branch.booking_id
    WHERE b.booking_status <> 'Cancelled'
  `,
  `
    CREATE OR REPLACE VIEW \`report_top_services\` AS
    SELECT
      sc.service_id,
      sc.public_id AS service_public_id,
      sc.service_name,
      SUM(su.quantity) AS total_quantity,
      COUNT(DISTINCT su.booking_id) AS booking_count,
      SUM(su.quantity * su.price_at_usage) AS total_revenue
    FROM service_catalogue sc
    JOIN service_usage su ON su.service_id = sc.service_id
    GROUP BY sc.service_id, sc.service_name
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
export async function initializeDatabase(database = pool) {
  const connection = await database.getConnection();

  try {
    for (const definition of tableDefinitions) {
      await connection.query(definition);
    }
    await ensureGuestAuthLink(connection);
    await installTriggers(connection);

    for (const definition of viewDefinitions) {
      await connection.query(definition);
    }

    console.log('Database tables initialized');
  } finally {
    connection.release();
    await database.end();
  }
}
