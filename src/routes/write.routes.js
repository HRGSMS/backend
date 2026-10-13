import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { pool } from '../config/db.js';
import { requireRole } from '../middleware/require-role.middleware.js';
import { notifyStaff } from '../sockets/index.js';

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

async function getGuestId(connection, publicId) {
  const [rows] = await connection.execute('SELECT guest_id FROM guest WHERE public_id = ?', [
    publicId,
  ]);
  if (!rows.length) throw validationError('guest_public_id does not identify an existing guest');
  return rows[0].guest_id;
}

async function getServiceId(connection, publicId) {
  const [rows] = await connection.execute(
    'SELECT service_id FROM service_catalogue WHERE public_id = ?',
    [publicId],
  );
  if (!rows.length)
    throw validationError('service_public_id does not identify an existing service');
  return rows[0].service_id;
}

async function getBooking(connection, publicId) {
  const [rows] = await connection.execute(
    'SELECT booking_id, public_id, booking_status FROM booking WHERE public_id = ?',
    [publicId],
  );
  if (!rows.length) {
    const error = new Error('booking_public_id does not identify an existing booking');
    error.statusCode = 404;
    throw error;
  }

  return rows[0];
}

async function getTaxId(connection, publicId) {
  if (publicId === undefined || publicId === null) return null;
  const [rows] = await connection.execute('SELECT tax_id FROM tax_rate WHERE public_id = ?', [
    publicId,
  ]);
  if (!rows.length) throw validationError('tax_public_id does not identify an existing tax rate');
  return rows[0].tax_id;
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
      const publicId = randomUUID();
      await connection.execute(
        `INSERT INTO guest (guest_id, public_id, first_name, last_name, email, phone_number)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [guestId, publicId, firstName, lastName, email, phoneNumber],
      );
      await connection.commit();
      notifyStaff({
        type: 'guest.created',
        message: 'A guest record was created',
        data: { public_id: publicId },
      });
      res.status(201).json({
        data: {
          public_id: publicId,
          first_name: firstName,
          last_name: lastName,
          email,
          phone_number: phoneNumber,
        },
      });
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

router.patch('/guests/:publicId', staffRoles, async (req, res, next) => {
  try {
    const publicId = requiredString(req.params.publicId, 'public_id', 36);
    const fields = {
      first_name: req.body?.first_name,
      last_name: req.body?.last_name,
      email: req.body?.email,
      phone_number: req.body?.phone_number,
    };
    const updates = Object.entries(fields).filter(([, value]) => value !== undefined);
    if (!updates.length) throw validationError('At least one guest field is required');
    for (const [name, value] of updates)
      requiredString(value, name, name === 'phone_number' ? 20 : name === 'email' ? 30 : 20);

    const [result] = await pool.execute(
      `UPDATE guest SET ${updates.map(([name]) => `\`${name}\` = ?`).join(', ')}
       WHERE public_id = ?`,
      [...updates.map(([, value]) => value.trim()), publicId],
    );
    if (!result.affectedRows) {
      res.status(404).json({ error: 'Guest not found' });
      return;
    }
    notifyStaff({
      type: 'guest.updated',
      message: 'A guest record was updated',
      data: { public_id: publicId },
    });
    res.json({ data: { public_id: publicId, updated: true } });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      res.status(409).json({ error: 'A guest with that email already exists' });
      return;
    }
    next(error);
  }
});

router.delete('/guests/:publicId', staffRoles, async (req, res, next) => {
  try {
    const publicId = requiredString(req.params.publicId, 'public_id', 36);
    const [result] = await pool.execute('DELETE FROM guest WHERE public_id = ?', [publicId]);
    if (!result.affectedRows) {
      res.status(404).json({ error: 'Guest not found' });
      return;
    }
    notifyStaff({
      type: 'guest.deleted',
      message: 'A guest record was deleted',
      data: { public_id: publicId },
    });
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
      const publicId = randomUUID();
      const taxId = await getTaxId(connection, req.body?.tax_public_id);
      await connection.execute(
        `INSERT INTO service_catalogue
          (service_id, public_id, service_name, service_description, current_price, price_update_time, tax_id)
         VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)`,
        [serviceId, publicId, serviceName, description, price, taxId],
      );
      await connection.commit();
      notifyStaff({
        type: 'service_catalogue.created',
        message: 'A service catalogue item was created',
        data: { public_id: publicId, service_name: serviceName },
      });
      res.status(201).json({
        data: {
          public_id: publicId,
          service_name: serviceName,
          service_description: description,
          current_price: price,
        },
      });
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

router.patch('/services/:publicId', catalogueRoles, async (req, res, next) => {
  try {
    const publicId = requiredString(req.params.publicId, 'public_id', 36);
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
      `UPDATE service_catalogue SET ${updates.join(', ')} WHERE public_id = ?`,
      [...values, publicId],
    );
    if (!result.affectedRows) {
      res.status(404).json({ error: 'Service not found' });
      return;
    }
    notifyStaff({
      type: 'service_catalogue.updated',
      message: 'A service catalogue item was updated',
      data: { public_id: publicId },
    });
    res.json({ data: { public_id: publicId, updated: true } });
  } catch (error) {
    next(error);
  }
});

router.delete('/services/:publicId', catalogueRoles, async (req, res, next) => {
  try {
    const publicId = requiredString(req.params.publicId, 'public_id', 36);
    const [result] = await pool.execute('DELETE FROM service_catalogue WHERE public_id = ?', [
      publicId,
    ]);
    if (!result.affectedRows) {
      res.status(404).json({ error: 'Service not found' });
      return;
    }
    notifyStaff({
      type: 'service_catalogue.deleted',
      message: 'A service catalogue item was deleted',
      data: { public_id: publicId },
    });
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
    const guestPublicId = requiredString(req.body?.guest_public_id, 'guest_public_id', 36);
    const checkIn = requiredDate(req.body?.check_in_time, 'check_in_time');
    const checkOut = requiredDate(req.body?.check_out_time, 'check_out_time');
    if (new Date(checkOut) <= new Date(checkIn))
      throw validationError('check_out_time must be after check_in_time');
    if (!Array.isArray(req.body?.room_public_ids) || !req.body.room_public_ids.length) {
      throw validationError('room_public_ids must contain at least one UUID');
    }
    const status = req.body.booking_status || 'Booked';
    if (!['Booked', 'Checked-In'].includes(status))
      throw validationError('New bookings may only be Booked or Checked-In');

    connection = await pool.getConnection();
    await connection.beginTransaction();
    const guestId = await getGuestId(connection, guestPublicId);
    const taxId = await getTaxId(connection, req.body?.tax_public_id);
    const bookingId = await nextId(connection, 'booking', 'booking_id');
    const publicId = randomUUID();
    await connection.execute(
      `INSERT INTO booking
        (booking_id, public_id, guest_id, booking_time, check_in_time, check_out_time,
         booking_status, payment_status, tax_id)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, 'Unpaid', ?)`,
      [bookingId, publicId, guestId, checkIn, checkOut, status, taxId],
    );
    for (const roomPublicId of req.body.room_public_ids) {
      const [rooms] = await connection.execute(
        'SELECT room_id FROM room WHERE public_id = ? FOR UPDATE',
        [roomPublicId],
      );
      if (!rooms.length) throw validationError(`Room ${roomPublicId} does not exist`);
      const [conflicts] = await connection.execute(
        `SELECT 1 FROM booking_room br JOIN booking b ON b.booking_id = br.booking_id
         WHERE br.room_id = ? AND b.booking_status IN ('Booked', 'Checked-In')
         AND b.check_in_time < ? AND b.check_out_time > ? LIMIT 1`,
        [rooms[0].room_id, checkOut, checkIn],
      );
      if (conflicts.length) {
        const error = new Error(`Room ${roomPublicId} is already booked for the requested period`);
        error.statusCode = 409;
        throw error;
      }
      await connection.execute(
        'INSERT INTO booking_room (booking_id, room_id, price_at_booking) VALUES (?, ?, NULL)',
        [bookingId, rooms[0].room_id],
      );
    }
    await connection.commit();
    notifyStaff({
      type: 'booking.created',
      message: 'A booking was created',
      data: { public_id: publicId, booking_status: status },
    });
    res.status(201).json({
      data: { public_id: publicId, booking_status: status },
    });
  } catch (error) {
    if (connection) await connection.rollback();
    if (
      error.statusCode ||
      error.code === 'ER_DUP_ENTRY' ||
      error.code === 'ER_NO_REFERENCED_ROW_2'
    ) {
      if (error.code === 'ER_DUP_ENTRY')
        res.status(409).json({ error: 'Booking conflicts with an existing record' });
      else if (error.code === 'ER_NO_REFERENCED_ROW_2')
        res.status(400).json({ error: 'A referenced record does not exist' });
      else res.status(error.statusCode).json({ error: error.message });
      return;
    }
    next(error);
  } finally {
    connection?.release();
  }
});

router.patch('/bookings/:publicId', staffRoles, async (req, res, next) => {
  let connection;
  try {
    const publicId = requiredString(req.params.publicId, 'public_id', 36);
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [bookings] = await connection.execute(
      'SELECT booking_id, booking_status, check_in_time, check_out_time, outstanding_amount, total_charge FROM booking WHERE public_id = ? FOR UPDATE',
      [publicId],
    );
    if (!bookings.length) {
      res.status(404).json({ error: 'Booking not found' });
      return;
    }
    const currentBooking = bookings[0];

    const targetStatus = req.body?.booking_status;
    const newCheckIn =
      req.body?.check_in_time !== undefined
        ? requiredDate(req.body.check_in_time, 'check_in_time')
        : null;
    const newCheckOut =
      req.body?.check_out_time !== undefined
        ? requiredDate(req.body.check_out_time, 'check_out_time')
        : null;

    const effectiveCheckIn = newCheckIn || currentBooking.check_in_time;
    const effectiveCheckOut = newCheckOut || currentBooking.check_out_time;

    if (new Date(effectiveCheckOut) <= new Date(effectiveCheckIn)) {
      throw validationError('check_out_time must be after check_in_time');
    }

    if (targetStatus !== undefined) {
      if (!['Booked', 'Checked-In', 'Checked-Out', 'Cancelled'].includes(targetStatus)) {
        throw validationError('Invalid booking_status');
      }
      if (targetStatus === 'Checked-Out') {
        await connection.execute('CALL sp_calculate_bill(?)', [currentBooking.booking_id]);
        const [refreshed] = await connection.execute(
          'SELECT outstanding_amount FROM booking WHERE booking_id = ?',
          [currentBooking.booking_id],
        );
        if (Number(refreshed[0]?.outstanding_amount) > 0) {
          const error = new Error(
            'Cannot check out with outstanding dues. Total bill must be paid before checkout.',
          );
          error.statusCode = 400;
          throw error;
        }
      }
    }

    if (newCheckIn || newCheckOut) {
      const [conflicts] = await connection.execute(
        `SELECT 1
         FROM booking_room br_this
         JOIN booking_room br_other ON br_other.room_id = br_this.room_id AND br_other.booking_id <> ?
         JOIN booking b_other ON b_other.booking_id = br_other.booking_id
         WHERE br_this.booking_id = ?
           AND b_other.booking_status IN ('Booked', 'Checked-In')
           AND b_other.check_in_time < ?
           AND b_other.check_out_time > ?
         LIMIT 1`,
        [currentBooking.booking_id, currentBooking.booking_id, effectiveCheckOut, effectiveCheckIn],
      );
      if (conflicts.length) {
        const error = new Error('Room is already booked for the updated period');
        error.statusCode = 409;
        throw error;
      }
    }

    const updates = [];
    const values = [];
    if (targetStatus !== undefined) {
      updates.push('booking_status = ?');
      values.push(targetStatus);
      if (targetStatus === 'Cancelled') {
        updates.push('cancellation_time = CURRENT_TIMESTAMP');
      }
    }
    if (newCheckIn) {
      updates.push('check_in_time = ?');
      values.push(newCheckIn);
    }
    if (newCheckOut) {
      updates.push('check_out_time = ?');
      values.push(newCheckOut);
    }
    if (!updates.length) throw validationError('At least one booking field is required');

    await connection.execute(`UPDATE booking SET ${updates.join(', ')} WHERE public_id = ?`, [
      ...values,
      publicId,
    ]);

    if (newCheckIn || newCheckOut || targetStatus === 'Checked-Out') {
      await connection.execute('CALL sp_calculate_bill(?)', [currentBooking.booking_id]);
    }

    await connection.commit();
    notifyStaff({
      type: 'booking.updated',
      message: 'A booking was updated',
      data: { public_id: publicId },
    });
    res.json({ data: { public_id: publicId, updated: true } });
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

router.delete('/bookings/:publicId', catalogueRoles, async (req, res, next) => {
  let connection;
  try {
    const publicId = requiredString(req.params.publicId, 'public_id', 36);
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [bookings] = await connection.execute(
      'SELECT booking_id FROM booking WHERE public_id = ? FOR UPDATE',
      [publicId],
    );

    if (!bookings.length) {
      await connection.rollback();
      res.status(404).json({ error: 'Booking not found' });
      return;
    }

    const bookingId = bookings[0].booking_id;
    await connection.execute('DELETE FROM service_usage WHERE booking_id = ?', [bookingId]);
    await connection.execute('DELETE FROM payment WHERE booking_id = ?', [bookingId]);
    await connection.execute('DELETE FROM booking_room WHERE booking_id = ?', [bookingId]);
    await connection.execute('DELETE FROM notification_outbox WHERE booking_id = ?', [bookingId]);
    await connection.execute('DELETE FROM booking WHERE booking_id = ?', [bookingId]);

    await connection.commit();
    notifyStaff({
      type: 'booking.deleted',
      message: 'A booking was deleted',
      data: { public_id: publicId },
    });
    res.status(204).send();
  } catch (error) {
    if (connection) await connection.rollback();
    next(error);
  } finally {
    connection?.release();
  }
});

router.post('/bookings/:publicId/payments', staffRoles, async (req, res, next) => {
  let connection;
  try {
    const publicId = requiredString(req.params.publicId, 'public_id', 36);
    const amount = requiredPositiveNumber(req.body?.amount, 'amount');
    const paymentMethod = requiredString(req.body?.payment_method, 'payment_method', 20);
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const booking = await getBooking(connection, publicId);
    const paymentId = await nextId(connection, 'payment', 'payment_id');
    await connection.execute(
      `INSERT INTO payment (payment_id, booking_id, payment_date, payment_method, amount)
       VALUES (?, ?, CURRENT_TIMESTAMP, ?, ?)`,
      [paymentId, booking.booking_id, paymentMethod, amount],
    );
    await connection.execute('CALL sp_calculate_bill(?)', [booking.booking_id]);
    await connection.commit();
    notifyStaff({
      type: 'payment.created',
      message: 'A payment was recorded',
      data: { booking_public_id: publicId, amount, payment_method: paymentMethod },
    });
    res.status(201).json({ data: { public_id: publicId, amount, payment_method: paymentMethod } });
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

router.post('/bookings/:publicId/services', staffRoles, async (req, res, next) => {
  let connection;
  try {
    const publicId = requiredString(req.params.publicId, 'public_id', 36);
    const servicePublicId = requiredString(req.body?.service_public_id, 'service_public_id', 36);
    const roomPublicId = requiredString(req.body?.room_public_id, 'room_public_id', 36);
    const quantity = requiredPositiveNumber(req.body?.quantity, 'quantity');
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const booking = await getBooking(connection, publicId);
    if (booking.booking_status !== 'Checked-In') {
      throw validationError('Service requests can only be created for checked-in bookings');
    }
    const serviceId = await getServiceId(connection, servicePublicId);
    const [rooms] = await connection.execute(
      `SELECT r.room_id
       FROM room r
       JOIN booking_room br ON br.room_id = r.room_id
       WHERE r.public_id = ? AND br.booking_id = ?`,
      [roomPublicId, booking.booking_id],
    );
    if (!rooms.length) {
      throw validationError('room_public_id does not identify a room assigned to this booking');
    }
    const usageId = await nextId(connection, 'service_usage', 'usage_id');
    const usagePublicId = randomUUID();
    await connection.execute(
      `INSERT INTO service_usage
        (usage_id, public_id, booking_id, service_id, room_id, usage_time, quantity, status)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, 'Pending')`,
      [usageId, usagePublicId, booking.booking_id, serviceId, rooms[0].room_id, quantity],
    );

    await connection.execute('CALL sp_calculate_bill(?)', [booking.booking_id]);
    await connection.commit();
    notifyStaff({
      type: 'service_request.created',
      message: 'A new guest service request was created',
      data: {
        public_id: usagePublicId,
        booking_public_id: publicId,
        service_public_id: servicePublicId,
        room_public_id: roomPublicId,
        quantity,
      },
    });
    res.status(201).json({
      data: {
        booking_public_id: publicId,
        public_id: usagePublicId,
        service_public_id: servicePublicId,
        room_public_id: roomPublicId,
        quantity,
        status: 'Pending',
      },
    });
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
