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
      `SELECT
         b.public_id,
         b.booking_time,
         b.check_in_time,
         b.check_out_time,
         b.cancellation_time,
         b.booking_status,
         b.payment_status,
         b.total_charge,
         b.outstanding_amount,
         b.total_tax_amount,
         b.cancellation_fee,
         COALESCE((SELECT SUM(p.amount) FROM payment p WHERE p.booking_id = b.booking_id), 0) AS paid_amount,
         GROUP_CONCAT(DISTINCT br_branch.name ORDER BY br_branch.name) AS branch_names,
         GROUP_CONCAT(DISTINCT r.room_number ORDER BY r.room_number) AS room_numbers,
         GROUP_CONCAT(DISTINCT rt.type_name ORDER BY rt.type_name) AS room_types,
         GROUP_CONCAT(DISTINCT r.public_id) AS room_public_ids
       FROM booking b
       LEFT JOIN booking_room br ON br.booking_id = b.booking_id
       LEFT JOIN room r ON r.room_id = br.room_id
       LEFT JOIN branch br_branch ON br_branch.branch_id = r.branch_id
       LEFT JOIN room_type rt ON rt.room_type_id = r.room_type_id
       WHERE b.guest_id = ?
       GROUP BY
         b.booking_id,
         b.public_id,
         b.booking_time,
         b.check_in_time,
         b.check_out_time,
         b.cancellation_time,
         b.booking_status,
         b.payment_status,
         b.total_charge,
         b.outstanding_amount,
         b.total_tax_amount,
         b.cancellation_fee
       ORDER BY b.check_in_time DESC`,
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
    const paymentMethod = req.body?.payment_method;
    if (typeof paymentMethod !== 'string' || !paymentMethod.trim()) {
      throw badRequest(
        'payment_method is required. An advance payment of at least 50% is required to secure a reservation',
      );
    }
    const paymentOption = req.body?.payment_option === 'full' ? 'full' : 'half';

    const roomIds = req.body.room_public_ids.map((value) => uuid(value, 'room_public_id'));
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const roomRecords = [];
    for (const roomPublicId of roomIds) {
      const [rooms] = await connection.execute(
        'SELECT room_id, branch_id FROM room WHERE public_id = ? FOR UPDATE',
        [roomPublicId],
      );
      if (!rooms.length) throw badRequest('A requested room does not exist');
      roomRecords.push({ ...rooms[0], public_id: roomPublicId });
    }

    const branchIds = new Set(roomRecords.map((r) => r.branch_id));
    if (branchIds.size > 1) {
      throw badRequest('All rooms in a reservation must belong to the same hotel branch');
    }

    const [branchTax] = await connection.execute(
      'SELECT tax_id FROM tax_rate WHERE branch_id = ? LIMIT 1',
      [roomRecords[0].branch_id],
    );
    const taxId = branchTax.length ? branchTax[0].tax_id : null;

    const bookingId = await nextId(connection, 'booking', 'booking_id');
    const publicId = randomUUID();
    await connection.execute(
      `INSERT INTO booking
       (booking_id, public_id, guest_id, booking_time,
        check_in_time, check_out_time, booking_status, payment_status, tax_id)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?, ?, 'Booked', 'Unpaid', ?)`,
      [bookingId, publicId, req.guest.guest_id, checkIn, checkOut, taxId],
    );

    for (const room of roomRecords) {
      const [conflicts] = await connection.execute(
        `SELECT 1 FROM booking_room br JOIN booking b ON b.booking_id = br.booking_id
         WHERE br.room_id = ? AND b.booking_status IN ('Booked', 'Checked-In')
           AND b.check_in_time < ? AND b.check_out_time > ? LIMIT 1`,
        [room.room_id, checkOut, checkIn],
      );
      if (conflicts.length)
        throw badRequest('A requested room is unavailable for the selected dates');
      await connection.execute(
        'INSERT INTO booking_room (booking_id, room_id, price_at_booking) VALUES (?, ?, NULL)',
        [bookingId, room.room_id],
      );
    }

    // Calculate initial bill to determine required 50% advance deposit
    await connection.execute('CALL sp_calculate_bill(?)', [bookingId]);

    const [billRows] = await connection.execute(
      'SELECT total_charge FROM booking WHERE booking_id = ?',
      [bookingId],
    );
    const totalCharge = Number(billRows[0]?.total_charge || 0);
    if (totalCharge <= 0) {
      throw badRequest('Calculated room charge must be greater than zero');
    }

    // Calculate deposit: 100% if full payment selected, otherwise 50%
    const depositAmount =
      paymentOption === 'full' ? totalCharge : Math.round(totalCharge * 0.5 * 100) / 100;

    const paymentId = await nextId(connection, 'payment', 'payment_id');
    const paymentPublicId = randomUUID();
    await connection.execute(
      `INSERT INTO payment
       (payment_id, public_id, booking_id, payment_date, payment_method, amount)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?, ?)`,
      [paymentId, paymentPublicId, bookingId, paymentMethod.trim(), depositAmount],
    );

    // Recalculate bill to apply deposit and update payment_status and outstanding_amount
    await connection.execute('CALL sp_calculate_bill(?)', [bookingId]);

    const [rows] = await connection.execute(
      `SELECT public_id, booking_status, payment_status, total_charge, outstanding_amount, total_tax_amount
       FROM booking WHERE booking_id = ?`,
      [bookingId],
    );

    await connection.commit();
    notifyStaff({
      type: 'booking.created',
      message: `A guest created a reservation with advance payment (${depositAmount} LKR)`,
      data: {
        public_id: publicId,
        guest_public_id: req.guest.public_id,
        paid_amount: depositAmount,
        payment_status: rows[0].payment_status,
      },
    });
    res.status(201).json({ data: rows[0] });
  } catch (error) {
    if (connection) await connection.rollback();
    if (error.code === 'ER_SIGNAL_EXCEPTION' || error.sqlState === '45000') {
      res.status(400).json({ error: error.sqlMessage || error.message });
      return;
    }
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
      'SELECT public_id, booking_status, cancellation_time, total_charge, payment_status, cancellation_fee FROM booking WHERE booking_id = ?',
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

router.get('/bookings/:publicId/services', async (req, res, next) => {
  try {
    const publicId = uuid(req.params.publicId, 'booking_public_id');
    const [rows] = await pool.execute(
      `SELECT
         su.public_id,
         sc.public_id AS service_public_id,
         sc.service_name,
         sc.service_description,
         su.usage_time,
         su.quantity,
         su.price_at_usage,
         su.status,
         r.room_number,
         r.public_id AS room_public_id
       FROM service_usage su
       JOIN booking b ON b.booking_id = su.booking_id
       JOIN service_catalogue sc ON sc.service_id = su.service_id
       JOIN room r ON r.room_id = su.room_id
       WHERE b.public_id = ? AND b.guest_id = ?
       ORDER BY su.usage_time DESC`,
      [publicId, req.guest.guest_id],
    );
    res.json({ data: rows });
  } catch (error) {
    next(error);
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
    if (!['Booked', 'Checked-In'].includes(booking.booking_status)) {
      throw badRequest('Service requests require an active or booked reservation');
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

    const [updatedRows] = await connection.execute(
      'SELECT outstanding_amount, payment_status, total_charge FROM booking WHERE booking_id = ?',
      [booking.booking_id],
    );
    await connection.commit();

    // Prepare SMS message notification for the logged-in guest
    const recipientPhone = (req.body?.phone_number || req.guest.phone_number || '').trim();
    const shortRef = publicId.slice(0, 8).toUpperCase();
    const guestName = req.guest.first_name || 'Guest';
    const remainingDue = Number(updatedRows[0]?.outstanding_amount ?? 0);
    const isFullyPaid = remainingDue <= 0;
    const statusNote = isFullyPaid
      ? 'Fully Paid'
      : `Remaining Balance: LKR ${remainingDue.toLocaleString()}`;
    const smsMessage = `SkyNest Hotels: Dear ${guestName}, your payment of LKR ${amount.toLocaleString()} for Reservation #${shortRef} has been successfully processed. Status: ${statusNote}. Thank you for staying with SkyNest Hotels!`;

    // Simulated SMS Gateway Dispatch
    console.log(
      `[SMS Gateway] Dispatched payment confirmation to ${recipientPhone || 'registered phone'}: "${smsMessage}"`,
    );

    notifyStaff({
      type: 'payment.created',
      message: 'A guest made a payment',
      data: {
        public_id: paymentPublicId,
        booking_public_id: publicId,
        amount,
        phone_number: recipientPhone,
      },
    });

    res.status(201).json({
      data: {
        public_id: paymentPublicId,
        booking_public_id: publicId,
        amount,
        outstanding_amount: updatedRows[0]?.outstanding_amount,
        payment_status: updatedRows[0]?.payment_status,
        sms_notification: {
          sent: Boolean(recipientPhone),
          phone_number: recipientPhone,
          message: smsMessage,
          timestamp: new Date().toISOString(),
        },
      },
    });
  } catch (error) {
    if (connection) await connection.rollback();
    next(error);
  } finally {
    connection?.release();
  }
});

export default router;
