import { pool } from '../src/config/db.js';

const branches = [
  [1, 'SkyNest Colombo', 'Colombo'],
  [2, 'SkyNest Kandy', 'Kandy'],
  [3, 'SkyNest Galle', 'Galle'],
];

const taxRates = [
  [1, 0.18, 1],
  [2, 0.18, 2],
  [3, 0.18, 3],
];

const roomTypes = [
  [1, 'Single', 'Comfortable room for one guest', 1, 15000, '2026-01-01 09:00:00'],
  [2, 'Double', 'Room with two single beds', 2, 22000, '2026-01-01 09:00:00'],
  [3, 'Deluxe', 'Spacious room with a king bed', 2, 30000, '2026-01-01 09:00:00'],
  [4, 'Family', 'Large room suitable for a family', 4, 40000, '2026-01-01 09:00:00'],
  [5, 'Suite', 'Premium suite with a separate living area', 3, 55000, '2026-01-01 09:00:00'],
];

const amenities = [
  [1, 'Wi-Fi', 'High-speed wireless internet'],
  [2, 'Air conditioning', 'Individually controlled air conditioning'],
  [3, 'Breakfast', 'Daily breakfast included'],
  [4, 'Sea view', 'Room with a sea view'],
  [5, 'Mini bar', 'In-room mini bar'],
];

const roomAmenities = [
  [1, 1],
  [2, 1],
  [2, 2],
  [2, 3],
  [3, 1],
  [3, 2],
  [3, 3],
  [3, 5],
  [4, 1],
  [4, 2],
  [4, 3],
  [4, 5],
  [5, 1],
  [5, 2],
  [5, 3],
  [5, 4],
  [5, 5],
];

const rooms = [
  [101, 1, 1, 'C101', 0, 1],
  [102, 1, 2, 'C102', 0, 1],
  [103, 1, 3, 'C103', 1, 0],
  [104, 1, 5, 'C104', 0, 1],
  [201, 2, 1, 'K201', 0, 1],
  [202, 2, 2, 'K202', 1, 0],
  [203, 2, 4, 'K203', 0, 1],
  [301, 3, 1, 'G301', 0, 1],
  [302, 3, 3, 'G302', 0, 1],
  [303, 3, 5, 'G303', 1, 0],
  [304, 3, 2, 'G304', 0, 1],
  [305, 3, 4, 'G305', 0, 1],
];

const services = [
  [
    1,
    'Room service',
    'Meals and refreshments delivered to the room',
    4500,
    '2026-01-01 09:00:00',
    1,
  ],
  [2, 'Spa treatment', 'Massage and wellness treatments', 12000, '2026-01-01 09:00:00', 1],
  [3, 'Laundry', 'Laundry and pressing service', 2500, '2026-01-01 09:00:00', 1],
  [4, 'Minibar', 'Snacks and drinks from the in-room minibar', 3000, '2026-01-01 09:00:00', 1],
  [5, 'Airport transfer', 'Private airport transfer service', 8000, '2026-01-01 09:00:00', 1],
  [6, 'City tour', 'Guided tour of local attractions', 10000, '2026-01-01 09:00:00', 1],
];

const guests = [
  [1, 'Amara', 'Perera', 'amara.perera@example.com', '+94771234567'],
  [2, 'Nimal', 'Fernando', 'nimal.fernando@example.com', '+94772345678'],
  [3, 'Kavya', 'Silva', 'kavya.silva@example.com', '+94773456789'],
  [4, 'Dilan', 'Jayawardena', 'dilan.j@example.com', '+94774567890'],
  [5, 'Maya', 'Wijesinghe', 'maya.w@example.com', '+94775678901'],
  [6, 'Oliver', 'Thompson', 'oliver.thompson@example.com', '+447700900123'],
  [7, 'Sophie', 'Chen', 'sophie.chen@example.com', '+61412345678'],
];

const bookings = [
  [
    1,
    1,
    '2026-09-01 10:00:00',
    '2026-09-10 14:00:00',
    '2026-09-13 11:00:00',
    null,
    'Checked-Out',
    'Paid',
    45000,
    0,
    1,
    8100,
  ],
  [
    2,
    2,
    '2026-09-05 12:00:00',
    '2026-09-15 14:00:00',
    '2026-09-18 11:00:00',
    null,
    'Checked-Out',
    'Partially Paid',
    66000,
    10000,
    1,
    11880,
  ],
  [
    3,
    3,
    '2026-09-15 09:30:00',
    '2026-10-05 14:00:00',
    '2026-10-08 11:00:00',
    null,
    'Checked-In',
    'Partially Paid',
    90000,
    30000,
    2,
    16200,
  ],
  [
    4,
    4,
    '2026-09-20 15:00:00',
    '2026-10-07 14:00:00',
    '2026-10-10 11:00:00',
    null,
    'Booked',
    'Unpaid',
    120000,
    120000,
    2,
    21600,
  ],
  [
    5,
    5,
    '2026-08-20 11:00:00',
    '2026-08-25 14:00:00',
    '2026-08-27 11:00:00',
    null,
    'Checked-Out',
    'Paid',
    60000,
    0,
    3,
    10800,
  ],
  [
    6,
    6,
    '2026-09-25 16:00:00',
    '2026-10-20 14:00:00',
    '2026-10-23 11:00:00',
    null,
    'Booked',
    'Partially Paid',
    165000,
    100000,
    3,
    29700,
  ],
  [
    7,
    7,
    '2026-10-01 13:00:00',
    '2026-11-01 14:00:00',
    '2026-11-04 11:00:00',
    null,
    'Booked',
    'Unpaid',
    90000,
    90000,
    1,
    16200,
  ],
  [
    8,
    4,
    '2026-10-02 10:00:00',
    '2026-12-15 14:00:00',
    '2026-12-18 11:00:00',
    '2026-10-04 10:00:00',
    'Cancelled',
    'Refunded',
    0,
    0,
    2,
    0,
  ],
];

const bookingRooms = [
  [1, 103, 90000],
  [2, 102, 66000],
  [3, 202, 90000],
  [4, 203, 120000],
  [5, 302, 60000],
  [6, 104, 165000],
  [7, 303, 90000],
  [8, 301, 0],
];

const serviceUsage = [
  [1, 1, 1, 103, '2026-09-11 19:30:00', 2, 4500],
  [2, 1, 3, 103, '2026-09-12 10:00:00', 1, 2500],
  [3, 2, 2, 102, '2026-09-16 16:00:00', 1, 12000],
  [4, 2, 4, 102, '2026-09-17 20:00:00', 2, 3000],
  [5, 3, 1, 202, '2026-10-06 19:00:00', 2, 4500],
  [6, 3, 3, 202, '2026-10-07 09:00:00', 2, 2500],
  [7, 5, 5, 302, '2026-08-26 08:00:00', 1, 8000],
  [8, 6, 6, 104, '2026-10-21 09:00:00', 2, 10000],
  [9, 7, 4, 303, '2026-11-02 21:00:00', 1, 3000],
];

const payments = [
  [1, 1, '2026-09-13 10:30:00', 'Card', 53100],
  [2, 2, '2026-09-15 12:00:00', 'Bank Transfer', 56000],
  [3, 3, '2026-10-05 13:00:00', 'Card', 60000],
  [4, 5, '2026-08-25 12:00:00', 'Cash', 70800],
  [5, 6, '2026-10-01 14:00:00', 'Card', 65000],
];

/**
 * Inserts a collection of parameterized rows into one table.
 *
 * @param {import('mysql2/promise').PoolConnection} connection Active transaction connection.
 * @param {string} table Destination table name.
 * @param {string[]} columns Destination column names.
 * @param {unknown[][]} rows Values to insert, in column order.
 * @returns {Promise<void>} Resolves after all rows have been inserted.
 */
const insertRows = async (connection, table, columns, rows) => {
  const placeholders = columns.map(() => '?').join(', ');
  const sql = `INSERT INTO \`${table}\` (${columns.map((column) => `\`${column}\``).join(', ')}) VALUES (${placeholders})`;

  for (const row of rows) {
    await connection.execute(sql, row);
  }
};

/**
 * Replaces the application data with the deterministic SkyNest sample dataset.
 *
 * All deletes and inserts run in one transaction. Any failure rolls the
 * transaction back so the database is not left partially seeded.
 *
 * @returns {Promise<void>} Resolves after the seed data has been committed.
 */
export async function seedDatabase() {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    for (const table of [
      'service_usage',
      'booking_room',
      'payment',
      'booking',
      'room_amenity',
      'service_catalogue',
      'room',
      'amenity',
      'room_type',
      'tax_rate',
      'branch',
      'guest',
    ]) {
      await connection.query(`DELETE FROM \`${table}\``);
    }

    await insertRows(connection, 'branch', ['branch_id', 'name', 'location_city'], branches);
    await insertRows(connection, 'tax_rate', ['tax_id', 'rate', 'branch_id'], taxRates);
    await insertRows(
      connection,
      'room_type',
      [
        'room_type_id',
        'type_name',
        'room_type_description',
        'capacity',
        'daily_rate',
        'rate_update_time',
      ],
      roomTypes,
    );
    await insertRows(
      connection,
      'amenity',
      ['amenity_id', 'amenity_name', 'amenity_description'],
      amenities,
    );
    await insertRows(connection, 'room_amenity', ['amenity_id', 'room_type_id'], roomAmenities);
    await insertRows(
      connection,
      'room',
      [
        'room_id',
        'branch_id',
        'room_type_id',
        'room_number',
        'current_status',
        'booking_availability',
      ],
      rooms,
    );
    await insertRows(
      connection,
      'service_catalogue',
      [
        'service_id',
        'service_name',
        'service_description',
        'current_price',
        'price_update_time',
        'tax_id',
      ],
      services,
    );
    await insertRows(
      connection,
      'guest',
      ['guest_id', 'first_name', 'last_name', 'email', 'phone_number'],
      guests,
    );
    await insertRows(
      connection,
      'booking',
      [
        'booking_id',
        'guest_id',
        'booking_time',
        'check_in_time',
        'check_out_time',
        'cancellation_time',
        'booking_status',
        'payment_status',
        'total_charge',
        'outstanding_amount',
        'tax_id',
        'total_tax_amount',
      ],
      bookings,
    );
    await insertRows(
      connection,
      'booking_room',
      ['booking_id', 'room_id', 'price_at_booking'],
      bookingRooms,
    );
    await insertRows(
      connection,
      'service_usage',
      [
        'usage_id',
        'booking_id',
        'service_id',
        'room_id',
        'usage_time',
        'quantity',
        'price_at_usage',
      ],
      serviceUsage,
    );
    await insertRows(
      connection,
      'payment',
      ['payment_id', 'booking_id', 'payment_date', 'payment_method', 'amount'],
      payments,
    );

    await connection.commit();
    console.log('Database seeded successfully');
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
    await pool.end();
  }
}

seedDatabase().catch((error) => {
  console.error('Database seeding failed:', error.message);
  process.exitCode = 1;
});
