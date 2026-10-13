import 'dotenv/config';
import { pool } from '../src/config/db.js';
import { installTriggers } from './triggers.js';

/**
 * Test script to verify MySQL triggers and stored procedures work correctly.
 * Run with: node db/test-triggers.js
 */

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

let passed = 0;
let failed = 0;

function logTest(name, ok, detail = '') {
  if (ok) {
    passed++;
    console.log(`${colors.green}✓${colors.reset} ${name} ${colors.gray}${detail}${colors.reset}`);
  } else {
    failed++;
    console.log(`${colors.red}✗${colors.reset} ${name} ${colors.red}${detail}${colors.reset}`);
  }
}

function eq(a, b) {
  // Loose equality for decimal comparison
  return Math.abs(Number(a) - Number(b)) < 0.01;
}

function logSection(title) {
  console.log(`\n${colors.cyan}━━━ ${title} ━━━${colors.reset}`);
}

async function runQuery(connection, sql, params = []) {
  const [rows] = await connection.execute(sql, params);
  return rows;
}

async function testTriggerValidation() {
  logSection('Trigger Validation Tests');
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // Test 1: Booking trigger - checkout must be after checkin
    try {
      await connection.execute(
        `INSERT INTO booking (booking_id, guest_id, booking_time, check_in_time, check_out_time, booking_status, payment_status, tax_id)
         VALUES (?, ?, NOW(), ?, ?, 'Booked', 'Unpaid', 1)`,
        [999, 1, '2030-10-15 14:00:00', '2030-10-10 11:00:00'], // checkout before checkin
      );
      logTest('Booking: checkout before checkin rejected', false, 'Should have thrown error');
    } catch (e) {
      logTest('Booking: checkout before checkin rejected', true, `Error: ${e.message}`);
    }

    // Test 2: Booking trigger - invalid status
    try {
      await connection.execute(
        `INSERT INTO booking (booking_id, guest_id, booking_time, check_in_time, check_out_time, booking_status, payment_status, tax_id)
         VALUES (?, ?, NOW(), ?, ?, ?, 'Unpaid', 1)`,
        [998, 1, '2030-10-10 14:00:00', '2030-10-15 11:00:00', 'InvalidStatus'],
      );
      logTest('Booking: invalid status rejected', false, 'Should have thrown error');
    } catch (e) {
      logTest('Booking: invalid status rejected', true, `Error: ${e.message}`);
    }

    // Test 3: Booking trigger - valid insert with tax rate auto-population
    try {
      await connection.execute(
        `INSERT INTO booking (booking_id, guest_id, booking_time, check_in_time, check_out_time, booking_status, payment_status, tax_id)
         VALUES (?, ?, NOW(), ?, ?, 'Booked', 'Unpaid', 1)`,
        [997, 1, '2030-10-10 14:00:00', '2030-10-15 11:00:00'],
      );
      const [rows] = await connection.execute(
        'SELECT tax_rate_at_booking FROM booking WHERE booking_id = 997',
      );
      const hasTaxRate = rows[0].tax_rate_at_booking !== null && rows[0].tax_rate_at_booking > 0;
      logTest(
        'Booking: tax_rate_at_booking auto-populated',
        hasTaxRate,
        `Value: ${rows[0].tax_rate_at_booking}`,
      );
    } catch (e) {
      logTest('Booking: tax_rate_at_booking auto-populated', false, `Error: ${e.message}`);
    }

    // Test 4: booking_room trigger - nightly_rate_at_booking auto-populated
    try {
      await connection.execute(
        `INSERT INTO booking_room (booking_id, room_id, price_at_booking) VALUES (?, ?, ?)`,
        [997, 101, 0], // price_at_booking will be calculated by trigger (5 nights * 15000 = 75000)
      );
      const [rows] = await connection.execute(
        'SELECT nightly_rate_at_booking, price_at_booking FROM booking_room WHERE booking_id = 997 AND room_id = 101',
      );
      const nightlyRate = rows[0].nightly_rate_at_booking;
      const priceAtBooking = rows[0].price_at_booking;
      const expectedNights = 5; // 10th to 15th = 5 nights
      const expectedPrice = nightlyRate * expectedNights;
      logTest(
        'booking_room: nightly_rate_at_booking & price_at_booking set',
        nightlyRate > 0 && eq(priceAtBooking, expectedPrice),
        `nightly_rate: ${nightlyRate}, price_at_booking: ${priceAtBooking}, expected: ${expectedPrice}`,
      );
    } catch (e) {
      logTest(
        'booking_room: nightly_rate_at_booking & price_at_booking set',
        false,
        `Error: ${e.message}`,
      );
    }

    // Test 5: service_usage trigger - quantity must be positive
    try {
      await connection.execute(
        `INSERT INTO service_usage (usage_id, booking_id, service_id, room_id, usage_time, quantity, price_at_usage)
         VALUES (?, ?, ?, ?, NOW(), ?, ?)`,
        [999, 997, 1, 101, 0, 4500],
      );
      logTest('service_usage: zero quantity rejected', false, 'Should have thrown error');
    } catch (e) {
      logTest('service_usage: zero quantity rejected', true, `Error: ${e.message}`);
    }

    // Test 6: service_usage trigger - price_at_usage auto-populated
    // Note: trigger only auto-populates tax_rate_at_usage when NULL, price_at_usage only when NULL
    // But price_at_usage is set to 0, not NULL. Let's test with NULL
    try {
      await connection.execute(
        `INSERT INTO service_usage (usage_id, booking_id, service_id, room_id, usage_time, quantity, price_at_usage)
         VALUES (?, ?, ?, ?, NOW(), ?, NULL)`,
        [998, 997, 1, 101, 2], // price_at_usage = NULL will trigger auto-population
      );
      const [rows] = await connection.execute(
        'SELECT price_at_usage, tax_rate_at_usage FROM service_usage WHERE usage_id = 998',
      );
      logTest(
        'service_usage: price_at_usage & tax_rate_at_usage auto-populated',
        rows[0].price_at_usage > 0 && rows[0].tax_rate_at_usage >= 0,
        `price: ${rows[0].price_at_usage}, tax: ${rows[0].tax_rate_at_usage}`,
      );
    } catch (e) {
      logTest(
        'service_usage: price_at_usage & tax_rate_at_usage auto-populated',
        false,
        `Error: ${e.message}`,
      );
    }

    // Test 7: service_usage trigger - room must belong to booking
    try {
      await connection.execute(
        `INSERT INTO service_usage (usage_id, booking_id, service_id, room_id, usage_time, quantity, price_at_usage)
         VALUES (?, ?, ?, ?, NOW(), ?, ?)`,
        [997, 997, 1, 999, 1, 4500], // room 999 doesn't belong to booking 997
      );
      logTest('service_usage: room not in booking rejected', false, 'Should have thrown error');
    } catch (e) {
      logTest('service_usage: room not in booking rejected', true, `Error: ${e.message}`);
    }

    // Test 8: payment trigger - amount must be positive
    try {
      await connection.execute(
        `INSERT INTO payment (payment_id, booking_id, payment_date, payment_method, amount) VALUES (?, ?, NOW(), 'Card', ?)`,
        [999, 997, 0],
      );
      logTest('payment: zero amount rejected', false, 'Should have thrown error');
    } catch (e) {
      logTest('payment: zero amount rejected', true, `Error: ${e.message}`);
    }

    // Test 9: room_type price trigger - negative price rejected
    try {
      await connection.execute(
        `INSERT INTO room_type (room_type_id, type_name, capacity, daily_rate, rate_update_time) VALUES (?, ?, ?, ?, NOW())`,
        [999, 'Test Room', 1, -100],
      );
      logTest('room_type: negative price rejected', false, 'Should have thrown error');
    } catch (e) {
      logTest('room_type: negative price rejected', true, `Error: ${e.message}`);
    }

    // Test 10: room_type price trigger - rate_update_time auto-set on insert
    try {
      await connection.execute(
        `INSERT INTO room_type (room_type_id, type_name, capacity, daily_rate, rate_update_time) VALUES (?, ?, ?, ?, NOW())`,
        [998, 'Test Room 2', 1, 15000],
      );
      const [rows] = await connection.execute(
        'SELECT rate_update_time FROM room_type WHERE room_type_id = 998',
      );
      logTest(
        'room_type: rate_update_time set on insert',
        !!rows[0].rate_update_time,
        `Value: ${rows[0].rate_update_time}`,
      );
    } catch (e) {
      logTest('room_type: rate_update_time set on insert', false, `Error: ${e.message}`);
    }

    // Test 11: room_type price trigger - rate_update_time updated on price change
    try {
      // First get the initial timestamp
      const [beforeRows] = await connection.execute(
        'SELECT rate_update_time FROM room_type WHERE room_type_id = 998',
      );
      const beforeTime = new Date(beforeRows[0].rate_update_time).getTime();

      // Wait a bit to ensure timestamp changes (MySQL DATETIME has second precision)
      await new Promise((resolve) => setTimeout(resolve, 1100));

      await connection.execute('UPDATE room_type SET daily_rate = 20000 WHERE room_type_id = 998');
      const [afterRows] = await connection.execute(
        'SELECT rate_update_time, daily_rate FROM room_type WHERE room_type_id = 998',
      );
      const afterTime = new Date(afterRows[0].rate_update_time).getTime();
      // Check that the rate was updated and timestamp changed
      const timeChanged = afterTime > beforeTime;
      const rateMatches = Number(afterRows[0].daily_rate) === 20000;
      logTest(
        'room_type: rate_update_time updated on price change',
        rateMatches && timeChanged,
        `rate: ${afterRows[0].daily_rate} (match: ${rateMatches}), timeChanged: ${timeChanged}, before: ${beforeTime}, after: ${afterTime}`,
      );
    } catch (e) {
      logTest('room_type: rate_update_time updated on price change', false, `Error: ${e.message}`);
    }

    // Test 12: service_catalogue price trigger
    try {
      await connection.execute(
        `INSERT INTO service_catalogue (service_id, service_name, current_price, price_update_time, tax_id) VALUES (?, ?, ?, NOW(), 1)`,
        [999, 'Test Service', 5000],
      );
      const [rows] = await connection.execute(
        'SELECT price_update_time, current_price FROM service_catalogue WHERE service_id = 999',
      );
      logTest(
        'service_catalogue: price_update_time set on insert',
        eq(rows[0].current_price, 5000) && !!rows[0].price_update_time,
        `price: ${rows[0].current_price}, updated: ${rows[0].price_update_time}`,
      );
    } catch (e) {
      logTest('service_catalogue: price_update_time set on insert', false, `Error: ${e.message}`);
    }

    // Test 13: Double-booking room rejected by trigger
    try {
      // Booking 997 is for room 101, 2030-10-10 to 2030-10-15
      // Attempt overlapping booking 996 for room 101, 2030-10-12 to 2030-10-14
      await connection.execute(
        `INSERT INTO booking (booking_id, guest_id, booking_time, check_in_time, check_out_time, booking_status, payment_status, tax_id)
         VALUES (?, ?, NOW(), ?, ?, 'Booked', 'Unpaid', 1)`,
        [996, 1, '2030-10-12 14:00:00', '2030-10-14 11:00:00'],
      );
      await connection.execute(
        `INSERT INTO booking_room (booking_id, room_id, price_at_booking) VALUES (?, ?, 0)`,
        [996, 101],
      );
      logTest('booking_room: overlapping booking rejected', false, 'Should have thrown error');
    } catch (e) {
      logTest('booking_room: overlapping booking rejected', true, `Error: ${e.message}`);
    }

    // Test 14: Checkout with outstanding dues rejected by trigger
    try {
      await connection.execute(
        `INSERT INTO booking (booking_id, guest_id, booking_time, check_in_time, check_out_time, booking_status, payment_status, tax_id, outstanding_amount)
         VALUES (?, ?, NOW(), ?, ?, 'Checked-Out', 'Unpaid', 1, 5000)`,
        [995, 1, '2030-10-20 14:00:00', '2030-10-25 11:00:00'],
      );
      logTest('booking: checkout with dues rejected', false, 'Should have thrown error');
    } catch (e) {
      logTest('booking: checkout with dues rejected', true, `Error: ${e.message}`);
    }

    // Test 15: Room status synchronized on Check-In and Check-Out
    try {
      await connection.execute(
        `INSERT INTO booking (booking_id, guest_id, booking_time, check_in_time, check_out_time, booking_status, payment_status, tax_id)
         VALUES (?, ?, NOW(), ?, ?, 'Booked', 'Unpaid', 1)`,
        [994, 1, '2030-11-10 14:00:00', '2030-11-15 11:00:00'],
      );
      await connection.execute(
        `INSERT INTO booking_room (booking_id, room_id, price_at_booking) VALUES (?, ?, 0)`,
        [994, 101],
      );
      // Check-in
      await connection.execute('UPDATE booking SET booking_status = ? WHERE booking_id = ?', [
        'Checked-In',
        994,
      ]);
      const [roomAfterCheckIn] = await connection.execute(
        'SELECT current_status, booking_availability FROM room WHERE room_id = 101',
      );
      const checkedInOk =
        roomAfterCheckIn[0].current_status === 1 && roomAfterCheckIn[0].booking_availability === 0;

      // Check-out (with outstanding = 0)
      await connection.execute(
        'UPDATE booking SET outstanding_amount = 0, booking_status = ? WHERE booking_id = ?',
        ['Checked-Out', 994],
      );
      const [roomAfterCheckOut] = await connection.execute(
        'SELECT current_status, booking_availability FROM room WHERE room_id = 101',
      );
      const checkedOutOk =
        roomAfterCheckOut[0].current_status === 0 &&
        roomAfterCheckOut[0].booking_availability === 1;

      logTest(
        'room: status synchronized on check-in and check-out',
        checkedInOk && checkedOutOk,
        `after check-in: (status: ${roomAfterCheckIn[0].current_status}, avail: ${roomAfterCheckIn[0].booking_availability}), after check-out: (status: ${roomAfterCheckOut[0].current_status}, avail: ${roomAfterCheckOut[0].booking_availability})`,
      );
    } catch (e) {
      logTest('room: status synchronized on check-in and check-out', false, `Error: ${e.message}`);
    }

    // Test 16: Multi-room booking across different branches rejected
    try {
      await connection.execute(
        `INSERT INTO booking (booking_id, guest_id, booking_time, check_in_time, check_out_time, booking_status, payment_status, tax_id)
         VALUES (?, ?, NOW(), ?, ?, 'Booked', 'Unpaid', 1)`,
        [993, 1, '2030-11-20 14:00:00', '2030-11-25 11:00:00'],
      );
      await connection.execute(
        `INSERT INTO booking_room (booking_id, room_id, price_at_booking) VALUES (?, ?, 0)`,
        [993, 101], // Colombo (Branch 1)
      );
      await connection.execute(
        `INSERT INTO booking_room (booking_id, room_id, price_at_booking) VALUES (?, ?, 0)`,
        [993, 201], // Kandy (Branch 2) - should fail
      );
      logTest('booking_room: multi-branch rooms rejected', false, 'Should have thrown error');
    } catch (e) {
      logTest('booking_room: multi-branch rooms rejected', true, `Error: ${e.message}`);
    }

    // Test 17: Booking room with mismatched tax_id branch rejected
    try {
      await connection.execute(
        `INSERT INTO booking (booking_id, guest_id, booking_time, check_in_time, check_out_time, booking_status, payment_status, tax_id)
         VALUES (?, ?, NOW(), ?, ?, 'Booked', 'Unpaid', 2)`, // Tax ID 2 is Kandy
        [992, 1, '2030-11-26 14:00:00', '2030-11-28 11:00:00'],
      );
      await connection.execute(
        `INSERT INTO booking_room (booking_id, room_id, price_at_booking) VALUES (?, ?, 0)`,
        [992, 101], // Colombo (Branch 1) - should fail because tax_id is Kandy (Branch 2)
      );
      logTest('booking_room: room branch mismatch with tax_id rejected', false, 'Should have thrown error');
    } catch (e) {
      logTest('booking_room: room branch mismatch with tax_id rejected', true, `Error: ${e.message}`);
    }

    // Test 18: Booking tax_id update mismatching existing rooms rejected
    try {
      await connection.execute(
        `INSERT INTO booking (booking_id, guest_id, booking_time, check_in_time, check_out_time, booking_status, payment_status, tax_id)
         VALUES (?, ?, NOW(), ?, ?, 'Booked', 'Unpaid', 1)`, // Tax ID 1 is Colombo
        [991, 1, '2030-11-29 14:00:00', '2030-11-30 11:00:00'],
      );
      await connection.execute(
        `INSERT INTO booking_room (booking_id, room_id, price_at_booking) VALUES (?, ?, 0)`,
        [991, 101], // Colombo (Branch 1)
      );
      // Attempt to change tax_id to Kandy (tax_id 2)
      await connection.execute(
        `UPDATE booking SET tax_id = 2 WHERE booking_id = 991`,
      );
      logTest('booking: updating tax_id to different branch rejected', false, 'Should have thrown error');
    } catch (e) {
      logTest('booking: updating tax_id to different branch rejected', true, `Error: ${e.message}`);
    }

    await connection.rollback(); // Rollback all test inserts
  } catch (e) {
    console.error(`${colors.red}Transaction error: ${e.message}${colors.reset}`);
    await connection.rollback();
  } finally {
    connection.release();
  }
}

async function testCalculateBill() {
  logSection('sp_calculate_bill Procedure Tests');
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // Test 1: Basic bill calculation for a booked stay
    try {
      // Create a booking with room
      await connection.execute(
        `INSERT INTO booking (booking_id, guest_id, booking_time, check_in_time, check_out_time, booking_status, payment_status, tax_id, tax_rate_at_booking)
         VALUES (?, ?, NOW(), ?, ?, 'Booked', 'Unpaid', 1, 0.18)`,
        [9001, 1, '2030-10-10 14:00:00', '2030-10-15 11:00:00'],
      );
      await connection.execute(
        `INSERT INTO booking_room (booking_id, room_id, price_at_booking) VALUES (?, ?, ?)`,
        [9001, 101, 0], // Will be calculated by trigger (5 nights * 15000 = 75000)
      );
      // Add service usage
      await connection.execute(
        `INSERT INTO service_usage (usage_id, booking_id, service_id, room_id, usage_time, quantity, price_at_usage, tax_rate_at_usage)
         VALUES (?, ?, ?, ?, NOW(), ?, ?, ?)`,
        [9001, 9001, 1, 101, 2, 4500, 0.18],
      );
      // Add payment
      await connection.execute(
        `INSERT INTO payment (payment_id, booking_id, payment_date, payment_method, amount) VALUES (?, ?, NOW(), 'Card', ?)`,
        [9001, 9001, 30000],
      );

      await connection.query('CALL sp_calculate_bill(9001)');

      const [booking] = await connection.execute(
        'SELECT total_charge, total_tax_amount, outstanding_amount, credit_amount, payment_status FROM booking WHERE booking_id = 9001',
      );

      const b = booking[0];
      // Room: 5 nights * 15000 = 75000
      // Service: 2 * 4500 = 9000
      // Tax on room: 75000 * 0.18 = 13500
      // Tax on service: 9000 * 0.18 = 1620
      // Total tax: 15120
      // Total charge: 75000 + 9000 + 15120 = 99120
      // Paid: 30000
      // Outstanding: 69120
      const expectedTotal = 99120;
      const expectedTax = 15120;
      const expectedOutstanding = 69120;

      logTest(
        'sp_calculate_bill: basic calculation',
        eq(b.total_charge, expectedTotal) &&
          eq(b.total_tax_amount, expectedTax) &&
          eq(b.outstanding_amount, expectedOutstanding) &&
          b.payment_status === 'Partially Paid',
        `total: ${b.total_charge} (exp ${expectedTotal}), tax: ${b.total_tax_amount} (exp ${expectedTax}), outstanding: ${b.outstanding_amount} (exp ${expectedOutstanding}), status: ${b.payment_status}`,
      );
    } catch (e) {
      logTest('sp_calculate_bill: basic calculation', false, `Error: ${e.message}`);
    }

    // Test 2: Cancelled booking with cancellation fee
    try {
      await connection.execute(
        `INSERT INTO booking (booking_id, guest_id, booking_time, check_in_time, check_out_time, booking_status, payment_status, tax_id, tax_rate_at_booking, cancellation_fee, cancellation_tax_amount, cancellation_charge_services)
         VALUES (?, ?, NOW(), ?, ?, 'Cancelled', 'Unpaid', 1, 0.18, 5000, 900, 0)`,
        [9002, 2, '2030-10-10 14:00:00', '2030-10-15 11:00:00'],
      );
      // No room or service charges for cancelled
      // Don't add payment - payment trigger requires amount > 0

      await connection.query('CALL sp_calculate_bill(9002)');

      const [booking] = await connection.execute(
        'SELECT total_charge, total_tax_amount, outstanding_amount, payment_status FROM booking WHERE booking_id = 9002',
      );

      const b = booking[0];
      // Cancelled: room charge = cancellation_fee = 5000
      // No services (cancellation_charge_services = 0)
      // Tax = cancellation_tax_amount = 900
      // Total = 5900
      const expectedTotal = 5900;

      logTest(
        'sp_calculate_bill: cancelled booking',
        eq(b.total_charge, expectedTotal) &&
          eq(b.total_tax_amount, 900) &&
          b.payment_status === 'Unpaid',
        `total: ${b.total_charge} (exp ${expectedTotal}), tax: ${b.total_tax_amount} (exp 900), status: ${b.payment_status}`,
      );
    } catch (e) {
      logTest('sp_calculate_bill: cancelled booking', false, `Error: ${e.message}`);
    }

    // Test 3: Fully paid booking
    try {
      await connection.execute(
        `INSERT INTO booking (booking_id, guest_id, booking_time, check_in_time, check_out_time, booking_status, payment_status, tax_id, tax_rate_at_booking)
         VALUES (?, ?, NOW(), ?, ?, 'Booked', 'Unpaid', 1, 0.18)`,
        [9003, 3, '2030-11-10 14:00:00', '2030-11-12 11:00:00'],
      );
      await connection.execute(
        `INSERT INTO booking_room (booking_id, room_id, price_at_booking) VALUES (?, ?, ?)`,
        [9003, 101, 0], // 2 nights * 15000 = 30000
      );
      await connection.execute(
        `INSERT INTO payment (payment_id, booking_id, payment_date, payment_method, amount) VALUES (?, ?, NOW(), 'Card', ?)`,
        [9003, 9003, 35400], // Full amount including tax
      );

      await connection.query('CALL sp_calculate_bill(9003)');

      const [booking] = await connection.execute(
        'SELECT total_charge, outstanding_amount, credit_amount, payment_status FROM booking WHERE booking_id = 9003',
      );

      const b = booking[0];
      // 2 nights * 15000 = 30000, tax = 5400, total = 35400
      // Paid = 35400, so credit = 0, status = Paid
      logTest(
        'sp_calculate_bill: fully paid booking',
        b.payment_status === 'Paid' && eq(b.outstanding_amount, 0) && eq(b.credit_amount, 0),
        `status: ${b.payment_status}, outstanding: ${b.outstanding_amount}, credit: ${b.credit_amount}`,
      );
    } catch (e) {
      logTest('sp_calculate_bill: fully paid booking', false, `Error: ${e.message}`);
    }

    // Test 4: Overpaid booking (credit due)
    try {
      await connection.execute(
        `INSERT INTO booking (booking_id, guest_id, booking_time, check_in_time, check_out_time, booking_status, payment_status, tax_id, tax_rate_at_booking)
         VALUES (?, ?, NOW(), ?, ?, 'Booked', 'Unpaid', 1, 0.18)`,
        [9004, 4, '2030-12-10 14:00:00', '2030-12-12 11:00:00'],
      );
      await connection.execute(
        `INSERT INTO booking_room (booking_id, room_id, price_at_booking) VALUES (?, ?, ?)`,
        [9004, 101, 0],
      );
      await connection.execute(
        `INSERT INTO payment (payment_id, booking_id, payment_date, payment_method, amount) VALUES (?, ?, NOW(), 'Card', ?)`,
        [9004, 9004, 40000], // Overpaid
      );

      await connection.query('CALL sp_calculate_bill(9004)');

      const [booking] = await connection.execute(
        'SELECT total_charge, outstanding_amount, credit_amount, payment_status FROM booking WHERE booking_id = 9004',
      );

      const b = booking[0];
      // Total = 35400, Paid = 40000, Credit = 4600
      logTest(
        'sp_calculate_bill: overpaid booking (credit due)',
        b.payment_status === 'Credit Due' &&
          eq(b.credit_amount, 4600) &&
          eq(b.outstanding_amount, 0),
        `status: ${b.payment_status}, credit: ${b.credit_amount} (exp 4600), outstanding: ${b.outstanding_amount}`,
      );
    } catch (e) {
      logTest('sp_calculate_bill: overpaid booking (credit due)', false, `Error: ${e.message}`);
    }

    // Test 5: Booking not found
    try {
      await connection.query('CALL sp_calculate_bill(99999)');
      logTest('sp_calculate_bill: booking not found throws error', false, 'Should have thrown');
    } catch (e) {
      logTest('sp_calculate_bill: booking not found throws error', true, `Error: ${e.message}`);
    }

    await connection.rollback();
  } catch (e) {
    console.error(`${colors.red}Transaction error: ${e.message}${colors.reset}`);
    await connection.rollback();
  } finally {
    connection.release();
  }
}

async function testCancelBooking() {
  logSection('sp_cancel_booking Procedure Tests');
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // Explicitly set the cancellation policies expected by this test suite within the transaction.
    // The transaction will be rolled back at the end of the test, restoring any preexisting policies.
    await connection.execute('DELETE FROM cancellation_policy');
    await connection.execute(
      `INSERT INTO cancellation_policy (rule_id, minimum_notice_hours, fee_type, fee_value, tax_rate, charge_services) VALUES (?, ?, ?, ?, ?, ?)`,
      [1, 24, 'percentage', 0.5, 0.18, 1],
    );
    await connection.execute(
      `INSERT INTO cancellation_policy (rule_id, minimum_notice_hours, fee_type, fee_value, tax_rate, charge_services) VALUES (?, ?, ?, ?, ?, ?)`,
      [2, 72, 'first_night', 1, 0.18, 1],
    );
    await connection.execute(
      `INSERT INTO cancellation_policy (rule_id, minimum_notice_hours, fee_type, fee_value, tax_rate, charge_services) VALUES (?, ?, ?, ?, ?, ?)`,
      [3, 168, 'fixed', 10000, 0.18, 0],
    );

    // Test 1: Cancel a booking more than 72 hours before check-in (first_night policy)
    try {
      // Create booking for ~10 days from now
      const checkIn = new Date();
      checkIn.setDate(checkIn.getDate() + 10);
      checkIn.setHours(14, 0, 0, 0);
      const checkOut = new Date(checkIn);
      checkOut.setDate(checkOut.getDate() + 5);
      checkOut.setHours(11, 0, 0, 0);

      await connection.execute(
        `INSERT INTO booking (booking_id, guest_id, booking_time, check_in_time, check_out_time, booking_status, payment_status, tax_id, tax_rate_at_booking)
         VALUES (?, ?, NOW(), ?, ?, 'Booked', 'Unpaid', 1, 0.18)`,
        [
          9101,
          1,
          checkIn.toISOString().slice(0, 19).replace('T', ' '),
          checkOut.toISOString().slice(0, 19).replace('T', ' '),
        ],
      );
      // Room rate: Deluxe = 30000, 5 nights
      await connection.execute(
        `INSERT INTO booking_room (booking_id, room_id, nightly_rate_at_booking, price_at_booking) VALUES (?, ?, ?, ?)`,
        [9101, 103, 30000, 150000],
      );
      // Add service usage
      await connection.execute(
        `INSERT INTO service_usage (usage_id, booking_id, service_id, room_id, usage_time, quantity, price_at_usage, tax_rate_at_usage)
         VALUES (?, ?, ?, ?, NOW(), ?, ?, ?)`,
        [9101, 9101, 1, 103, 1, 4500, 0.18],
      );

      await connection.query('CALL sp_cancel_booking(9101)');

      const [booking] = await connection.execute(
        'SELECT booking_status, cancellation_fee, cancellation_tax_amount, cancellation_charge_services, cancellation_rule_id FROM booking WHERE booking_id = 9101',
      );

      const b = booking[0];
      // 10+ days notice -> rule 3 (fixed, 168 hours)
      // Fee = 10000, Tax = 10000 * 0.18 = 1800
      // Services charged = false (charge_services = 0 for rule 3)
      logTest(
        'sp_cancel_booking: >168h notice (fixed fee)',
        b.booking_status === 'Cancelled' &&
          eq(b.cancellation_fee, 10000) &&
          eq(b.cancellation_tax_amount, 1800) &&
          b.cancellation_charge_services === 0 &&
          b.cancellation_rule_id === 3,
        `status: ${b.booking_status}, fee: ${b.cancellation_fee}, tax: ${b.cancellation_tax_amount}, services: ${b.cancellation_charge_services}, rule: ${b.cancellation_rule_id}`,
      );
    } catch (e) {
      logTest('sp_cancel_booking: >168h notice (fixed fee)', false, `Error: ${e.message}`);
    }

    // Test 2: Cancel a booking 24-72 hours before check-in (percentage policy)
    try {
      const checkIn2 = new Date();
      checkIn2.setDate(checkIn2.getDate() + 2); // 2 days = 48 hours
      checkIn2.setHours(14, 0, 0, 0);
      const checkOut2 = new Date(checkIn2);
      checkOut2.setDate(checkOut2.getDate() + 2);
      checkOut2.setHours(11, 0, 0, 0);

      await connection.execute(
        `INSERT INTO booking (booking_id, guest_id, booking_time, check_in_time, check_out_time, booking_status, payment_status, tax_id, tax_rate_at_booking)
         VALUES (?, ?, NOW(), ?, ?, 'Booked', 'Unpaid', 1, 0.18)`,
        [
          9102,
          2,
          checkIn2.toISOString().slice(0, 19).replace('T', ' '),
          checkOut2.toISOString().slice(0, 19).replace('T', ' '),
        ],
      );
      // Room: 2 nights * 15000 = 30000
      await connection.execute(
        `INSERT INTO booking_room (booking_id, room_id, nightly_rate_at_booking, price_at_booking) VALUES (?, ?, ?, ?)`,
        [9102, 101, 15000, 30000],
      );

      await connection.query('CALL sp_cancel_booking(9102)');

      const [booking] = await connection.execute(
        'SELECT booking_status, cancellation_fee, cancellation_tax_amount, cancellation_rule_id FROM booking WHERE booking_id = 9102',
      );

      const b = booking[0];
      // ~2 days notice -> rule 1 (percentage, 24 hours)
      // Fee = 50% of 30000 = 15000
      // Tax = 15000 * 0.18 = 2700
      logTest(
        'sp_cancel_booking: 24-72h notice (percentage)',
        b.booking_status === 'Cancelled' &&
          eq(b.cancellation_fee, 15000) &&
          eq(b.cancellation_tax_amount, 2700) &&
          b.cancellation_rule_id === 1,
        `status: ${b.booking_status}, fee: ${b.cancellation_fee}, tax: ${b.cancellation_tax_amount}, rule: ${b.cancellation_rule_id}`,
      );
    } catch (e) {
      logTest('sp_cancel_booking: 24-72h notice (percentage)', false, `Error: ${e.message}`);
    }

    // Test 3: Cannot cancel non-Booked status
    try {
      await connection.execute(
        `INSERT INTO booking (booking_id, guest_id, booking_time, check_in_time, check_out_time, booking_status, payment_status, tax_id, tax_rate_at_booking)
         VALUES (?, ?, NOW(), ?, ?, 'Checked-In', 'Unpaid', 1, 0.18)`,
        [9103, 3, '2030-10-10 14:00:00', '2030-10-15 11:00:00'],
      );
      await connection.execute(
        `INSERT INTO booking_room (booking_id, room_id, nightly_rate_at_booking, price_at_booking) VALUES (?, ?, ?, ?)`,
        [9103, 101, 15000, 75000],
      );

      await connection.query('CALL sp_cancel_booking(9103)');
      logTest('sp_cancel_booking: non-Booked status rejected', false, 'Should have thrown');
    } catch (e) {
      logTest('sp_cancel_booking: non-Booked status rejected', true, `Error: ${e.message}`);
    }

    // Test 4: Booking not found
    try {
      await connection.query('CALL sp_cancel_booking(99999)');
      logTest('sp_cancel_booking: booking not found throws error', false, 'Should have thrown');
    } catch (e) {
      logTest('sp_cancel_booking: booking not found throws error', true, `Error: ${e.message}`);
    }

    await connection.rollback();
  } catch (e) {
    console.error(`${colors.red}Transaction error: ${e.message}${colors.reset}`);
    await connection.rollback();
  } finally {
    connection.release();
  }
}

async function testEdgeCases() {
  logSection('Edge Case Tests');
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // Test: UPDATE trigger on booking - tax_rate_at_booking should not change if already set
    try {
      await connection.execute(
        `INSERT INTO booking (booking_id, guest_id, booking_time, check_in_time, check_out_time, booking_status, payment_status, tax_id, tax_rate_at_booking)
         VALUES (?, ?, NOW(), ?, ?, 'Booked', 'Unpaid', 1, 0.10)`,
        [9201, 1, '2030-10-10 14:00:00', '2030-10-15 11:00:00'],
      );
      // Update booking - tax_rate_at_booking should remain 0.10, not be overwritten
      await connection.execute('UPDATE booking SET booking_status = ? WHERE booking_id = ?', [
        'Checked-In',
        9201,
      ]);
      const [rows] = await connection.execute(
        'SELECT tax_rate_at_booking FROM booking WHERE booking_id = 9201',
      );
      logTest(
        'Booking UPDATE: tax_rate_at_booking preserved',
        eq(rows[0].tax_rate_at_booking, 0.1),
        `Value: ${rows[0].tax_rate_at_booking}`,
      );
    } catch (e) {
      logTest('Booking UPDATE: tax_rate_at_booking preserved', false, `Error: ${e.message}`);
    }

    // Test: UPDATE trigger on service_usage - price/tax preserved
    try {
      // First need a valid booking with room 101
      await connection.execute(
        `INSERT INTO booking (booking_id, guest_id, booking_time, check_in_time, check_out_time, booking_status, payment_status, tax_id, tax_rate_at_booking)
         VALUES (?, ?, NOW(), ?, ?, 'Booked', 'Unpaid', 1, 0.18)`,
        [9200, 1, '2030-10-10 14:00:00', '2030-10-15 11:00:00'],
      );
      await connection.execute(
        `INSERT INTO booking_room (booking_id, room_id, price_at_booking) VALUES (?, ?, ?)`,
        [9200, 101, 0],
      );
      await connection.execute(
        `INSERT INTO service_usage (usage_id, booking_id, service_id, room_id, usage_time, quantity, price_at_usage, tax_rate_at_usage)
         VALUES (?, ?, ?, ?, NOW(), ?, ?, ?)`,
        [9201, 9200, 1, 101, 2, 5000, 0.15],
      );
      await connection.execute(
        'UPDATE service_usage SET quantity = ? WHERE usage_id = ?',
        [3, 9201],
      );
      const [rows] = await connection.execute(
        'SELECT price_at_usage, tax_rate_at_usage FROM service_usage WHERE usage_id = 9201',
      );
      logTest(
        'service_usage UPDATE: price/tax preserved',
        eq(rows[0].price_at_usage, 5000) && eq(rows[0].tax_rate_at_usage, 0.15),
        `price: ${rows[0].price_at_usage}, tax: ${rows[0].tax_rate_at_usage}`,
      );
    } catch (e) {
      logTest('service_usage UPDATE: price/tax preserved', false, `Error: ${e.message}`);
    }

    await connection.rollback();
  } catch (e) {
    console.error(`${colors.red}Transaction error: ${e.message}${colors.reset}`);
    await connection.rollback();
  } finally {
    connection.release();
  }
}

async function main() {
  console.log(`${colors.cyan}╔══════════════════════════════════════════╗${colors.reset}`);
  console.log(`${colors.cyan}║   MySQL Trigger & Procedure Test Suite   ║${colors.reset}`);
  console.log(`${colors.cyan}╚══════════════════════════════════════════╝${colors.reset}`);

  // First, initialize the database with triggers
  logSection('Initializing Database');
  try {
    const connection = await pool.getConnection();
    await installTriggers(connection);
    connection.release();
    logTest('Database initialization with triggers', true);
  } catch (e) {
    logTest('Database initialization with triggers', false, e.message);
    process.exit(1);
  }

  // Run tests
  await testTriggerValidation();
  await testCalculateBill();
  await testCancelBooking();
  await testEdgeCases();

  // Summary
  console.log(`\n${colors.cyan}═══════════════════════════════════════════${colors.reset}`);
  console.log(
    `${colors.cyan}Summary${colors.reset}: ${colors.green}${passed} passed${colors.reset}, ${colors.red}${failed} failed${colors.reset}`,
  );
  console.log(`${colors.cyan}═══════════════════════════════════════════${colors.reset}`);

  await pool.end();

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`${colors.red}Test runner failed:${colors.reset}`, error);
  process.exitCode = 1;
});
