import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { pool } from '../config/db.js';
import { requireGuest } from '../middleware/require-guest.middleware.js';
import { notifyStaff } from '../sockets/index.js';

const router = Router();

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function uuid(value, name) {
  if (typeof value !== 'string' || !/^[0-9a-f-]{36}$/i.test(value)) {
    throw badRequest(`${name} must be a UUID`);
  }
  return value;
}

function positiveNumber(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw badRequest(`${name} must be positive`);
  return number;
}

async function nextId(connection, table, column) {
  const [rows] = await connection.execute(
    `SELECT COALESCE(MAX(\`${column}\`), 0) + 1 AS next_id FROM \`${table}\` FOR UPDATE`,
  );
  return rows[0].next_id;
}

async function linkedBooking(connection, guestId, publicId) {
  const [rows] = await connection.execute(
    `SELECT booking_id, public_id, booking_status
     FROM booking WHERE public_id = ? AND guest_id = ?`,
    [publicId, guestId],
  );
  if (!rows.length) {
    const error = new Error('Reservation not found');
    error.statusCode = 404;
    throw error;
  }
  return rows[0];
}

router.use(requireGuest);

router.get('/profile', async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      'SELECT public_id, first_name, last_name, email, phone_number FROM guest WHERE guest_id = ?',
      [req.guest.guest_id],
    );
    res.json({ data: rows[0] });
  } catch (error) {
    next(error);
  }
});

router.get('/bookings', async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT b.public_id, b.booking_reference, b.booking_time, b.check_in_time,
              b.check_out_time, b.cancellation_time, b.booking_status,
              b.payment_status, b.total_charge, b.outstanding_amount
       FROM booking b WHERE b.guest_id = ? ORDER BY b.check_in_time DESC`,
      [req.guest.guest_id],
    );
    res.json({ data: rows });
  } catch (error) {
    next(error);
  }
});

router.post('/bookings', async (req, res, next) => {
  let connection;
  try {
    const checkIn = req.body?.check_in_time;
    const checkOut = req.body?.check_out_time;
    if (!checkIn || !checkOut || new Date(checkOut) <= new Date(checkIn)) {
      throw badRequest('check_in_time and check_out_time must be valid and ordered');
    }
    if (!Array.isArray(req.body?.room_public_ids) || !req.body.room_public_ids.length) {
      throw badRequest('room_public_ids must contain at least one UUID');
    }
    const roomIds = req.body.room_public_ids.map((value) => uuid(value, 'room_public_id'));
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const bookingId = await nextId(connection, 'booking', 'booking_id');
    const publicId = randomUUID();
    const bookingReference = randomUUID();
    await connection.execute(
      `INSERT INTO booking
       (booking_id, public_id, booking_reference, guest_id, booking_time,
        check_in_time, check_out_time, booking_status, payment_status)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, 'Booked', 'Unpaid')`,
      [bookingId, publicId, bookingReference, req.guest.guest_id, checkIn, checkOut],
    );
    for (const roomPublicId of roomIds) {
      const [rooms] = await connection.execute(
        'SELECT room_id FROM room WHERE public_id = ? FOR UPDATE',
        [roomPublicId],
      );
      if (!rooms.length) throw badRequest('A requested room does not exist');
      const [conflicts] = await connection.execute(
        `SELECT 1 FROM booking_room br JOIN booking b ON b.booking_id = br.booking_id
         WHERE br.room_id = ? AND b.booking_status IN ('Booked', 'Checked-In')
           AND b.check_in_time < ? AND b.check_out_time > ? LIMIT 1`,
        [rooms[0].room_id, checkOut, checkIn],
      );
      if (conflicts.length) throw badRequest('A requested room is unavailable');
      await connection.execute(
        'INSERT INTO booking_room (booking_id, room_id, price_at_booking) VALUES (?, ?, NULL)',
        [bookingId, rooms[0].room_id],
      );
    }
    await connection.commit();
    notifyStaff({
      type: 'booking.created',
      message: 'A guest created a reservation',
      data: { public_id: publicId, guest_public_id: req.guest.public_id },
    });
    res.status(201).json({ data: { public_id: publicId, booking_reference: bookingReference } });
  } catch (error) {
    if (connection) await connection.rollback();
    next(error);
  } finally {
    connection?.release();
  }
});

router.post('/bookings/:publicId/cancel', async (req, res, next) => {
  let connection;
  try {
    const publicId = uuid(req.params.publicId, 'booking_public_id');
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const booking = await linkedBooking(connection, req.guest.guest_id, publicId);
    if (booking.booking_status !== 'Booked') {
      throw badRequest('Only Booked reservations can be cancelled');
    }
    await connection.execute('CALL sp_cancel_booking(?)', [booking.booking_id]);
    const [rows] = await connection.execute(
      'SELECT public_id, booking_status, cancellation_time, total_charge, payment_status FROM booking WHERE booking_id = ?',
      [booking.booking_id],
    );
    await connection.commit();
    notifyStaff({
      type: 'booking.cancelled',
      message: 'A guest cancelled a reservation',
      data: rows[0],
    });
    res.json({ data: rows[0] });
  } catch (error) {
    if (connection) await connection.rollback();
    next(error);
  } finally {
    connection?.release();
  }
});

router.post('/bookings/:publicId/services', async (req, res, next) => {
  let connection;
  try {
    const publicId = uuid(req.params.publicId, 'booking_public_id');
    const servicePublicId = uuid(req.body?.service_public_id, 'service_public_id');
    const roomPublicId = uuid(req.body?.room_public_id, 'room_public_id');
    const quantity = positiveNumber(req.body?.quantity, 'quantity');
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const booking = await linkedBooking(connection, req.guest.guest_id, publicId);
    if (booking.booking_status !== 'Checked-In') {
      throw badRequest('Service requests require a checked-in reservation');
    }
    const [services] = await connection.execute(
      'SELECT service_id FROM service_catalogue WHERE public_id = ?',
      [servicePublicId],
    );
    const [rooms] = await connection.execute(
      `SELECT r.room_id FROM room r JOIN booking_room br ON br.room_id = r.room_id
       WHERE r.public_id = ? AND br.booking_id = ?`,
      [roomPublicId, booking.booking_id],
    );
    if (!services.length || !rooms.length) throw badRequest('Service or room was not found');
    const usageId = await nextId(connection, 'service_usage', 'usage_id');
    const usagePublicId = randomUUID();
    await connection.execute(
      `INSERT INTO service_usage
       (usage_id, public_id, booking_id, service_id, room_id, usage_time, quantity, status)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, 'Pending')`,
      [
        usageId,
        usagePublicId,
        booking.booking_id,
        services[0].service_id,
        rooms[0].room_id,
        quantity,
      ],
    );
    await connection.execute('CALL sp_calculate_bill(?)', [booking.booking_id]);
    await connection.commit();
    notifyStaff({
      type: 'service_request.created',
      message: 'A guest created a service request',
      data: { public_id: usagePublicId, booking_public_id: publicId },
    });
    res.status(201).json({ data: { public_id: usagePublicId, status: 'Pending' } });
  } catch (error) {
    if (connection) await connection.rollback();
    next(error);
  } finally {
    connection?.release();
  }
});

router.delete('/service-requests/:publicId', async (req, res, next) => {
  let connection;
  try {
    const requestPublicId = uuid(req.params.publicId, 'service_request_public_id');
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [requests] = await connection.execute(
      `SELECT su.usage_id, su.booking_id
       FROM service_usage su
       JOIN booking b ON b.booking_id = su.booking_id
       WHERE su.public_id = ? AND b.guest_id = ? AND su.status = 'Pending'
       FOR UPDATE`,
      [requestPublicId, req.guest.guest_id],
    );
    if (!requests.length) {
      await connection.rollback();
      res.status(404).json({ error: 'Pending service request not found' });
      return;
    }
    await connection.execute('DELETE FROM service_usage WHERE usage_id = ?', [
      requests[0].usage_id,
    ]);
    await connection.execute('CALL sp_calculate_bill(?)', [requests[0].booking_id]);
    await connection.commit();
    notifyStaff({
      type: 'service_request.cancelled',
      message: 'A guest cancelled a service request',
      data: { public_id: requestPublicId },
    });
    res.status(204).send();
  } catch (error) {
    if (connection) await connection.rollback();
    next(error);
  } finally {
    connection?.release();
  }
});

router.post('/bookings/:publicId/payments', async (req, res, next) => {
  let connection;
  try {
    const publicId = uuid(req.params.publicId, 'booking_public_id');
    const amount = positiveNumber(req.body?.amount, 'amount');
    const paymentMethod = req.body?.payment_method;
    if (typeof paymentMethod !== 'string' || !paymentMethod.trim()) {
      throw badRequest('payment_method is required');
    }
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const booking = await linkedBooking(connection, req.guest.guest_id, publicId);
    const paymentId = await nextId(connection, 'payment', 'payment_id');
    const paymentPublicId = randomUUID();
    await connection.execute(
      `INSERT INTO payment
       (payment_id, public_id, booking_id, payment_date, payment_method, amount)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?, ?)`,
      [paymentId, paymentPublicId, booking.booking_id, paymentMethod.trim(), amount],
    );
    await connection.execute('CALL sp_calculate_bill(?)', [booking.booking_id]);
    await connection.commit();
    notifyStaff({
      type: 'payment.created',
      message: 'A guest made a payment',
      data: { public_id: paymentPublicId, booking_public_id: publicId, amount },
    });
    res
      .status(201)
      .json({ data: { public_id: paymentPublicId, booking_public_id: publicId, amount } });
  } catch (error) {
    if (connection) await connection.rollback();
    next(error);
  } finally {
    connection?.release();
  }
});

export default router;
