/**
 * patch-remove-hardcodes.js
 *
 * Idempotent migration that:
 *  1. Creates hotel_config table (key-value store for hotel-wide settings)
 *  2. Seeds default rows (hotline, check-in/out times)
 *  3. Creates payment_method table
 *  4. Seeds default payment methods
 *  5. Ensures room_type_amenity table exists
 *  6. Adds amenities column to rooms view (handled via query join, no schema change needed)
 */

import { pool } from '../src/config/db.js';

async function run() {
  const connection = await pool.getConnection();
  try {
    // ── 1. hotel_config table ─────────────────────────────────────────────
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`hotel_config\` (
        \`config_key\`   VARCHAR(80)   NOT NULL,
        \`config_value\` VARCHAR(255)  NOT NULL,
        \`description\`  VARCHAR(255)  NULL,
        PRIMARY KEY (\`config_key\`)
      )
    `);
    console.log('hotel_config table ensured');

    // Seed default rows (INSERT IGNORE = idempotent)
    await connection.query(`
      INSERT IGNORE INTO \`hotel_config\` (\`config_key\`, \`config_value\`, \`description\`) VALUES
        ('hotel_name',        'SkyNest Hotels',                   'Public hotel brand name'),
        ('hotel_tagline',     'Luxury Stays & Serenity',          'Short tagline shown in header'),
        ('hotel_description', 'Discover tailored comfort across our Sri Lanka locations. Book with flexible half-payments and personalise your stay.', 'Hero description text'),
        ('hotline_number',    '0760218879',                       'Public customer hotline number'),
        ('hotline_label',     '24/7 Hotel Hotline',               'Label shown on floating contact button'),
        ('checkin_time',      '14:00',                            'Default check-in time (HH:MM)'),
        ('checkout_time',     '11:00',                            'Default check-out time (HH:MM)'),
        ('currency',          'LKR',                              'Display currency code'),
        ('copyright_text',    'Dedicated to comfort, elegance, and peace.', 'Footer copyright tagline')
    `);
    console.log('hotel_config rows seeded');

    // ── 2. payment_method table ───────────────────────────────────────────
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`payment_method\` (
        \`method_id\`    INT          NOT NULL AUTO_INCREMENT,
        \`public_id\`    CHAR(36)     NOT NULL UNIQUE DEFAULT (UUID()),
        \`method_name\`  VARCHAR(60)  NOT NULL UNIQUE,
        \`display_name\` VARCHAR(80)  NOT NULL,
        \`is_active\`    TINYINT(1)   NOT NULL DEFAULT 1,
        PRIMARY KEY (\`method_id\`)
      )
    `);
    console.log('payment_method table ensured');

    await connection.query(`
      INSERT IGNORE INTO \`payment_method\` (\`method_name\`, \`display_name\`) VALUES
        ('Credit Card',      'Credit / Debit Card'),
        ('Online Transfer',  'Online Bank Transfer'),
        ('Cash Deposit',     'Direct Deposit')
    `);
    console.log('payment_method rows seeded');

    // ── 3. Ensure room_type_amenity join table exists ─────────────────────
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`room_type_amenity\` (
        \`room_type_id\` INT NOT NULL,
        \`amenity_id\`   INT NOT NULL,
        PRIMARY KEY (\`room_type_id\`, \`amenity_id\`),
        FOREIGN KEY (\`room_type_id\`) REFERENCES \`room_type\`(\`room_type_id\`),
        FOREIGN KEY (\`amenity_id\`)   REFERENCES \`amenity\`(\`amenity_id\`)
      )
    `);
    console.log('room_type_amenity table ensured');

    console.log('\n✅ patch-remove-hardcodes complete');
  } catch (err) {
    console.error('Patch failed:', err.message);
    throw err;
  } finally {
    connection.release();
    await pool.end();
  }
}

run();
