import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { pool } from '../config/db.js';
import { requireRole } from '../middleware/require-role.middleware.js';

const router = Router();
const staffRoles = requireRole('admin', 'manager', 'front_desk');
const catalogueRoles = requireRole('admin', 'manager');

function validationError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function requiredString(value, name, maxLength = 255) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength) {
    throw validationError(`${name} must be a non-empty string of at most ${maxLength} characters`);
  }
  return value.trim();
}

function requiredPositiveNumber(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw validationError(`${name} must be a positive number`);
  }
  return number;
}

function requiredDate(value, name) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) {
    throw validationError(`${name} must be a valid date`);
  }
  return value;
}

function handleDatabaseError(error, res, next) {
  if (error.code === 'ER_DUP_ENTRY') {
    res.status(409).json({ error: 'A record with the same unique value already exists' });
    return;
  }
  if (error.code === 'ER_NO_REFERENCED_ROW_2') {
    res.status(400).json({ error: 'A referenced record does not exist' });
    return;
  }
  next(error);
}

async function nextId(connection, table, column) {
  const [rows] = await connection.execute(
    `SELECT COALESCE(MAX(\`${column}\`), 0) + 1 AS next_id FROM \`${table}\` FOR UPDATE`,
  );
  return rows[0].next_id;
}

async function getGuestId(connection, email) {
  const [rows] = await connection.execute('SELECT guest_id FROM guest WHERE email = ?', [email]);
  if (!rows.length) throw validationError('guest_email does not identify an existing guest');
  return rows[0].guest_id;
}

async function getServiceId(connection, serviceName) {
  const [rows] = await connection.execute(
    'SELECT service_id FROM service_catalogue WHERE service_name = ?',
    [serviceName],
  );
  if (!rows.length) throw validationError('service_name does not identify an existing service');
  return rows[0].service_id;
}

async function getBooking(connection, bookingReference) {
  const [rows] = await connection.execute(
    'SELECT booking_id, booking_reference FROM booking WHERE booking_reference = ?',
    [bookingReference],
  );
  if (!rows.length) {
    const error = new Error('booking_reference does not identify an existing booking');
    error.statusCode = 404;
    throw error;
  }
  return rows[0];
}

router.post('/guests', staffRoles, async (req, res, next) => {
  try {
    const firstName = requiredString(req.body?.first_name, 'first_name', 20);
    const lastName = requiredString(req.body?.last_name, 'last_name', 20);
    const email = requiredString(req.body?.email, 'email', 30);
    const phoneNumber = requiredString(req.body?.phone_number, 'phone_number', 20);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const guestId = await nextId(connection, 'guest', 'guest_id');
      await connection.execute(
        `INSERT INTO guest (guest_id, first_name, last_name, email, phone_number)
         VALUES (?, ?, ?, ?, ?)`,
        [guestId, firstName, lastName, email, phoneNumber],
      );
      await connection.commit();
      res.status(201).json({ data: { first_name: firstName, last_name: lastName, email, phone_number: phoneNumber } });
    } catch (error) {
      await connection.rollback();
      handleDatabaseError(error, res, next);
    } finally {
      connection.release();
    }
  } catch (error) {
    next(error);
  }
});

router.patch('/guests/:email', staffRoles, async (req, res, next) => {
  try {
    const currentEmail = requiredString(req.params.email, 'email', 30);
    const fields = {
      first_name: req.body?.first_name,
      last_name: req.body?.last_name,
      email: req.body?.email,
      phone_number: req.body?.phone_number,
    };
    const updates = Object.entries(fields).filter(([, value]) => value !== undefined);
    if (!updates.length) throw validationError('At least one guest field is required');
    for (const [name, value] of updates) requiredString(value, name, name === 'phone_number' ? 20 : name === 'email' ? 30 : 20);

    const [result] = await pool.execute(
      `UPDATE guest SET ${updates.map(([name]) => `\`${name}\` = ?`).join(', ')}
       WHERE email = ?`,
      [...updates.map(([, value]) => value.trim()), currentEmail],
    );
    if (!result.affectedRows) {
      res.status(404).json({ error: 'Guest not found' });
      return;
    }
    res.json({ data: { email: fields.email || currentEmail, updated: true } });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      res.status(409).json({ error: 'A guest with that email already exists' });
      return;
    }
    next(error);
  }
});

router.delete('/guests/:email', staffRoles, async (req, res, next) => {
  try {
    const email = requiredString(req.params.email, 'email', 30);
    const [result] = await pool.execute('DELETE FROM guest WHERE email = ?', [email]);
    if (!result.affectedRows) {
      res.status(404).json({ error: 'Guest not found' });
      return;
    }
    res.status(204).send();
  } catch (error) {
    if (error.code === 'ER_ROW_IS_REFERENCED_2') {
      res.status(409).json({ error: 'Guest cannot be deleted while bookings reference the guest' });
      return;
    }
    next(error);
  }
});

router.post('/services', catalogueRoles, async (req, res, next) => {
  try {
    const serviceName = requiredString(req.body?.service_name, 'service_name', 20);
    const description = requiredString(req.body?.service_description, 'service_description', 100);
    const price = requiredPositiveNumber(req.body?.current_price, 'current_price');
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const serviceId = await nextId(connection, 'service_catalogue', 'service_id');
      await connection.execute(
        `INSERT INTO service_catalogue
          (service_id, service_name, service_description, current_price, price_update_time, tax_id)
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?)`,
        [serviceId, serviceName, description, price, req.body?.tax_id ?? null],
      );
      await connection.commit();
      res.status(201).json({ data: { service_name: serviceName, service_description: description, current_price: price } });
    } catch (error) {
      await connection.rollback();
      handleDatabaseError(error, res, next);
    } finally {
      connection.release();
    }
  } catch (error) {
    next(error);
  }
});

router.patch('/services/:serviceName', catalogueRoles, async (req, res, next) => {
  try {
    const serviceName = requiredString(req.params.serviceName, 'service_name', 20);
    const updates = [];
    const values = [];
    if (req.body?.service_description !== undefined) {
      updates.push('service_description = ?');
      values.push(requiredString(req.body.service_description, 'service_description', 100));
    }
    if (req.body?.current_price !== undefined) {
      updates.push('current_price = ?');
      values.push(requiredPositiveNumber(req.body.current_price, 'current_price'));
    }
    if (!updates.length) throw validationError('service_description or current_price is required');
    updates.push('price_update_time = CURRENT_TIMESTAMP');
    const [result] = await pool.execute(
      `UPDATE service_catalogue SET ${updates.join(', ')} WHERE service_name = ?`,
      [...values, serviceName],
    );
    if (!result.affectedRows) {
      res.status(404).json({ error: 'Service not found' });
      return;
    }
    res.json({ data: { service_name: serviceName, updated: true } });
  } catch (error) {
    next(error);
  }
});

router.delete('/services/:serviceName', catalogueRoles, async (req, res, next) => {
  try {
    const serviceName = requiredString(req.params.serviceName, 'service_name', 20);
    const [result] = await pool.execute('DELETE FROM service_catalogue WHERE service_name = ?', [serviceName]);
    if (!result.affectedRows) {
      res.status(404).json({ error: 'Service not found' });
      return;
    }
    res.status(204).send();
  } catch (error) {
    if (error.code === 'ER_ROW_IS_REFERENCED_2') {
      res.status(409).json({ error: 'Service cannot be deleted while usage records reference it' });
      return;
    }
    next(error);
  }
});

router.post('/bookings', staffRoles, async (req, res, next) => {
  let connection;
  try {
    const guestEmail = requiredString(req.body?.guest_email, 'guest_email', 30);
    const checkIn = requiredDate(req.body?.check_in_time, 'check_in_time');
    const checkOut = requiredDate(req.body?.check_out_time, 'check_out_time');
    if (new Date(checkOut) <= new Date(checkIn)) throw validationError('check_out_time must be after check_in_time');
    if (!Array.isArray(req.body?.room_numbers) || !req.body.room_numbers.length) {
      throw validationError('room_numbers must contain at least one room number');
    }
    const status = req.body.booking_status || 'Booked';
    if (!['Booked', 'Checked-In'].includes(status)) throw validationError('New bookings may only be Booked or Checked-In');

    connection = await pool.getConnection();
    await connection.beginTransaction();
    const guestId = await getGuestId(connection, guestEmail);
    const bookingId = await nextId(connection, 'booking', 'booking_id');
    const bookingReference = randomUUID();
    await connection.execute(
      `INSERT INTO booking
        (booking_id, booking_reference, guest_id, booking_time, check_in_time, check_out_time,
         booking_status, payment_status, tax_id)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, 'Unpaid', ?)`,
      [bookingId, bookingReference, guestId, checkIn, checkOut, status, req.body.tax_id ?? null],
    );
    for (const roomNumber of req.body.room_numbers) {
      const [rooms] = await connection.execute('SELECT room_id FROM room WHERE room_number = ? FOR UPDATE', [roomNumber]);
      if (!rooms.length) throw validationError(`Room ${roomNumber} does not exist`);
      const [conflicts] = await connection.execute(
        `SELECT 1 FROM booking_room br JOIN booking b ON b.booking_id = br.booking_id
         WHERE br.room_id = ? AND b.booking_status IN ('Booked', 'Checked-In')
         AND b.check_in_time < ? AND b.check_out_time > ? LIMIT 1`,
        [rooms[0].room_id, checkOut, checkIn],
      );
      if (conflicts.length) {
        const error = new Error(`Room ${roomNumber} is already booked for the requested period`);
        error.statusCode = 409;
        throw error;
      }
      await connection.execute(
        'INSERT INTO booking_room (booking_id, room_id, price_at_booking) VALUES (?, ?, NULL)',
        [bookingId, rooms[0].room_id],
      );
    }
    await connection.commit();
    res.status(201).json({ data: { booking_reference: bookingReference, booking_status: status } });
  } catch (error) {
    if (connection) await connection.rollback();
    if (error.statusCode || error.code === 'ER_DUP_ENTRY' || error.code === 'ER_NO_REFERENCED_ROW_2') {
      if (error.code === 'ER_DUP_ENTRY') res.status(409).json({ error: 'Booking conflicts with an existing record' });
      else if (error.code === 'ER_NO_REFERENCED_ROW_2') res.status(400).json({ error: 'A referenced record does not exist' });
      else res.status(error.statusCode).json({ error: error.message });
      return;
    }
    next(error);
  } finally {
    connection?.release();
  }
});

router.patch('/bookings/:bookingReference', staffRoles, async (req, res, next) => {
  try {
    const reference = requiredString(req.params.bookingReference, 'booking_reference', 36);
    const updates = [];
    const values = [];
    if (req.body?.booking_status !== undefined) {
      if (!['Booked', 'Checked-In', 'Checked-Out', 'Cancelled'].includes(req.body.booking_status)) {
        throw validationError('Invalid booking_status');
      }
      updates.push('booking_status = ?');
      values.push(req.body.booking_status);
      if (req.body.booking_status === 'Cancelled') updates.push('cancellation_time = CURRENT_TIMESTAMP');
    }
    if (req.body?.check_in_time !== undefined) {
      updates.push('check_in_time = ?');
      values.push(requiredDate(req.body.check_in_time, 'check_in_time'));
    }
    if (req.body?.check_out_time !== undefined) {
      updates.push('check_out_time = ?');
      values.push(requiredDate(req.body.check_out_time, 'check_out_time'));
    }
    if (!updates.length) throw validationError('At least one booking field is required');
    const [result] = await pool.execute(
      `UPDATE booking SET ${updates.join(', ')} WHERE booking_reference = ?`,
      [...values, reference],
    );
    if (!result.affectedRows) {
      res.status(404).json({ error: 'Booking not found' });
      return;
    }
    res.json({ data: { booking_reference: reference, updated: true } });
  } catch (error) {
    next(error);
  }
});

router.delete('/bookings/:bookingReference', catalogueRoles, async (req, res, next) => {
  try {
    const reference = requiredString(req.params.bookingReference, 'booking_reference', 36);
    const [result] = await pool.execute(
      `UPDATE booking SET booking_status = 'Cancelled', cancellation_time = CURRENT_TIMESTAMP
       WHERE booking_reference = ? AND booking_status = 'Booked'`,
      [reference],
    );
    if (!result.affectedRows) {
      res.status(404).json({ error: 'Booked booking not found; only Booked bookings can be cancelled' });
      return;
    }
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

router.post('/bookings/:bookingReference/payments', staffRoles, async (req, res, next) => {
  let connection;
  try {
    const reference = requiredString(req.params.bookingReference, 'booking_reference', 36);
    const amount = requiredPositiveNumber(req.body?.amount, 'amount');
    const paymentMethod = requiredString(req.body?.payment_method, 'payment_method', 20);
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const booking = await getBooking(connection, reference);
    const paymentId = await nextId(connection, 'payment', 'payment_id');
    await connection.execute(
      `INSERT INTO payment (payment_id, booking_id, payment_date, payment_method, amount)
       VALUES (?, ?, CURRENT_TIMESTAMP, ?, ?)`,
      [paymentId, booking.booking_id, paymentMethod, amount],
    );
    await connection.execute('CALL sp_calculate_bill(?)', [booking.booking_id]);
    await connection.commit();
    res.status(201).json({ data: { booking_reference: reference, amount, payment_method: paymentMethod } });
  } catch (error) {
    if (connection) await connection.rollback();
    if (error.statusCode) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    handleDatabaseError(error, res, next);
  } finally {
    connection?.release();
  }
});

router.post('/bookings/:bookingReference/services', staffRoles, async (req, res, next) => {
  let connection;
  try {
    const reference = requiredString(req.params.bookingReference, 'booking_reference', 36);
    const serviceName = requiredString(req.body?.service_name, 'service_name', 20);
    const roomNumber = requiredString(req.body?.room_number, 'room_number', 5);
    const quantity = requiredPositiveNumber(req.body?.quantity, 'quantity');
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const booking = await getBooking(connection, reference);
    const serviceId = await getServiceId(connection, serviceName);
    const [rooms] = await connection.execute('SELECT room_id FROM room WHERE room_number = ?', [roomNumber]);
    if (!rooms.length) throw validationError('room_number does not identify an existing room');
    const usageId = await nextId(connection, 'service_usage', 'usage_id');
    await connection.execute(
      `INSERT INTO service_usage (usage_id, booking_id, service_id, room_id, usage_time, quantity)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?)`,
      [usageId, booking.booking_id, serviceId, rooms[0].room_id, quantity],
    );
    await connection.execute('CALL sp_calculate_bill(?)', [booking.booking_id]);
    await connection.commit();
    res.status(201).json({ data: { booking_reference: reference, service_name: serviceName, room_number: roomNumber, quantity } });
  } catch (error) {
    if (connection) await connection.rollback();
    if (error.statusCode) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    handleDatabaseError(error, res, next);
  } finally {
    connection?.release();
  }
});

export default router;
