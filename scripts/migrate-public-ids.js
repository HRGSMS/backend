import 'dotenv/config';
import mysql from 'mysql2/promise';

const tables = [
  'guest',
  'branch',
  'tax_rate',
  'booking',
  'payment',
  'room_type',
  'room',
  'service_catalogue',
  'amenity',
  'room_amenity',
  'booking_room',
  'service_usage',
];

const connection = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

const quote = (identifier) => `\`${identifier}\``;

try {
  const [dbRows] = await connection.query(
    'SELECT DATABASE() AS database_name',
  );
  const database = dbRows[0].database_name;

  // Safety guard: never run against a different database accidentally.
  if (database !== 'hrgsms') {
    throw new Error(
      `Expected database hrgsms, but connected to ${database}. No migration performed.`,
    );
  }

  console.log(`Target database: ${database}`);

  // Preflight every table before making any schema changes.
  const initialCounts = {};

  for (const table of tables) {
    const [exists] = await connection.execute(
      `SELECT TABLE_NAME
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      [table],
    );

    if (exists.length !== 1) {
      throw new Error(`Required table "${table}" does not exist.`);
    }

    const [columns] = await connection.query(
      `SHOW COLUMNS FROM ${quote(table)}`,
    );

    if (!columns.some((column) => column.Field === 'public_id')) {
      // Check the expected primary key exists before proceeding.
      const [primaryKeys] = await connection.execute(
        `SELECT COLUMN_NAME
         FROM information_schema.KEY_COLUMN_USAGE
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = ?
           AND CONSTRAINT_NAME = 'PRIMARY'`,
        [table],
      );

      if (primaryKeys.length === 0) {
        throw new Error(`No primary key found on "${table}".`);
      }
    }

    const [countRows] = await connection.query(
      `SELECT COUNT(*) AS total FROM ${quote(table)}`,
    );
    initialCounts[table] = Number(countRows[0].total);
  }

  console.log('Preflight passed. Starting migration...');

  for (const table of tables) {
    const [columns] = await connection.query(
      `SHOW COLUMNS FROM ${quote(table)}`,
    );

    let publicId = columns.find((column) => column.Field === 'public_id');

    if (!publicId) {
      await connection.query(
        `ALTER TABLE ${quote(table)}
         ADD COLUMN \`public_id\` CHAR(36) NULL`,
      );
      console.log(`${table}: added nullable public_id`);
    } else if (!['char', 'varchar'].includes(
      String(publicId.Type).split('(')[0].toLowerCase()
    ) || !String(publicId.Type).includes('36')) {
      throw new Error(
        `${table}.public_id has unexpected type ${publicId.Type}; stopped for manual review.`,
      );
    }

    // Fill only missing UUIDs. Existing UUIDs are never overwritten.
    await connection.query(
      `UPDATE ${quote(table)}
       SET \`public_id\` = UUID()
       WHERE \`public_id\` IS NULL OR TRIM(\`public_id\`) = ''`,
    );

    // Validate that every row has a unique UUID before adding constraints.
    const [invalidRows] = await connection.query(
      `SELECT
         COUNT(*) AS total_rows,
         COUNT(\`public_id\`) AS populated_rows,
         COUNT(DISTINCT \`public_id\`) AS distinct_ids
       FROM ${quote(table)}`,
    );

    const validation = invalidRows[0];

    if (
      Number(validation.total_rows) !== Number(validation.populated_rows) ||
      Number(validation.total_rows) !== Number(validation.distinct_ids)
    ) {
      throw new Error(
        `${table}: missing or duplicate public_id values. Stopped for review.`,
      );
    }

    // Apply the expected MySQL 8 UUID default and NOT NULL constraint.
    await connection.query(
      `ALTER TABLE ${quote(table)}
       MODIFY COLUMN \`public_id\` CHAR(36) NOT NULL DEFAULT (UUID())`,
    );

    // Add a unique index only if a single-column unique index is absent.
    const [indexes] = await connection.execute(
      `SELECT INDEX_NAME
       FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = ?
         AND COLUMN_NAME = 'public_id'
         AND NON_UNIQUE = 0
       GROUP BY INDEX_NAME
       HAVING COUNT(*) = 1
          AND MAX(SEQ_IN_INDEX) = 1`,
      [table],
    );

    if (indexes.length === 0) {
      await connection.query(
        `ALTER TABLE ${quote(table)}
         ADD UNIQUE INDEX ${quote(`uq_${table}_public_id`)} (\`public_id\`)`,
      );
    }

    console.log(
      `${table}: UUIDs populated and uniqueness enforced (${initialCounts[table]} original rows)`,
    );
  }

  console.log('\nVerifying row counts and UUID constraints...');

  for (const table of tables) {
    const [counts] = await connection.query(
      `SELECT COUNT(*) AS total,
              COUNT(\`public_id\`) AS populated,
              COUNT(DISTINCT \`public_id\`) AS distinct_ids
       FROM ${quote(table)}`,
    );

    const result = counts[0];
    const original = initialCounts[table];

    if (
      Number(result.total) !== original ||
      Number(result.populated) !== original ||
      Number(result.distinct_ids) !== original
    ) {
      throw new Error(
        `${table}: validation failed. Original rows=${original}; current rows=${result.total}; populated UUIDs=${result.populated}; distinct UUIDs=${result.distinct_ids}.`,
      );
    }

    const [columnRows] = await connection.query(
      `SHOW COLUMNS FROM ${quote(table)} LIKE 'public_id'`,
    );

    if (
      columnRows.length !== 1 ||
      columnRows[0].Null !== 'NO' ||
      !String(columnRows[0].Type).includes('36')
    ) {
      throw new Error(`${table}: public_id column definition is incorrect.`);
    }

    console.log(`${table}: verified (${original} rows)`);
  }

  console.log(
    '\nSUCCESS: all 12 tables passed UUID and row-count validation.',
  );
  console.log(
    'Existing integer primary keys, foreign keys, and booking_reference values were not intentionally modified.',
  );
} catch (error) {
  console.error('\nMIGRATION STOPPED:', error.message);
  console.error(
    'Some earlier DDL changes may already have been applied. Do not drop tables or restore the backup over the live database; inspect the schema and rerun only after resolving the reported issue.',
  );
  process.exitCode = 1;
} finally {
  await connection.end();
}
