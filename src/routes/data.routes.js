import { Router } from 'express';
import { pool } from '../config/db.js';

const router = Router();

router.use((req, res, next) => {
  const identifierQuery = Object.keys(req.query).find(
    (key) =>
      !key.endsWith('_public_id') &&
      (key === 'id' || key === 'ids' || key.endsWith('_id')),
  );

  if (identifierQuery) {
    res.status(400).json({
      error: 'Querying by database identifiers is not supported',
    });
    return;
  }

  next();
});

function parseDate(value, name) {
  const date = new Date(value);

  if (!value || Number.isNaN(date.getTime())) {
    const error = new Error(`${name} must be a valid date`);
    error.statusCode = 400;
    throw error;
  }

  return value;
}

/**
 * Returns a paginated result from a table with a stable primary-key order.
 *
 * @param {import('express').Request} req Incoming request.
 * @param {import('express').Response} res Outgoing response.
 * @param {import('express').NextFunction} next Express error callback.
 * @param {string} table Safe, hard-coded table name.
 * @param {string} columns Safe, hard-coded select list.
 * @param {string} idColumn Safe, hard-coded primary-key column.
 * @returns {Promise<void>} Resolves after sending the result.
 */
async function listTable(req, res, next, table, columns, idColumn) {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const [rows] = await pool.execute(
      `SELECT ${columns} FROM \`${table}\` ORDER BY \`${idColumn}\` LIMIT ? OFFSET ?`,
      [limit, offset],
    );

    res.json({ data: rows, limit, offset });
  } catch (error) {
    next(error);
  }
}

router.get('/branches', (req, res, next) =>
  listTable(req, res, next, 'branch', 'public_id, name, location_city', 'branch_id'),
);

router.get('/room-types', (req, res, next) =>
  listTable(
    req,
    res,
    next,
    'room_type',
    'public_id, type_name, room_type_description, capacity, daily_rate, rate_update_time',
    'room_type_id',
  ),
);

router.get('/amenities', (req, res, next) =>
  listTable(req, res, next, 'amenity', 'public_id, amenity_name, amenity_description', 'amenity_id'),
);

router.get('/services', (req, res, next) =>
  listTable(
    req,
    res,
    next,
    'service_catalogue',
    'public_id, service_name, service_description, current_price, price_update_time',
    'service_id',
  ),
);

router.get('/guests', (req, res, next) =>
  listTable(
    req,
    res,
    next,
    'guest',
    'public_id, first_name, last_name, email, phone_number',
    'guest_id',
  ),
);

router.get('/rooms', async (req, res, next) => {
  try {
    const parameters = [];
    let availabilityFilter = '';

    if (req.query.available_from && req.query.available_to) {
      const availableFrom = parseDate(req.query.available_from, 'available_from');
      const availableTo = parseDate(req.query.available_to, 'available_to');

      if (new Date(availableFrom) >= new Date(availableTo)) {
        const error = new Error('available_to must be after available_from');
        error.statusCode = 400;
        throw error;
      }

      parameters.push(availableFrom, availableTo, availableTo, availableFrom);
      availabilityFilter += `
        AND NOT EXISTS (
          SELECT 1
          FROM booking_room br_filter
          JOIN booking b_filter ON b_filter.booking_id = br_filter.booking_id
          WHERE br_filter.room_id = r.room_id
            AND b_filter.booking_status IN ('Booked', 'Checked-In')
            AND b_filter.check_in_time < ?
            AND b_filter.check_out_time > ?
        )
      `;
    }

    const [rows] = await pool.execute(
      `
        SELECT
          b.name AS branch_name,
          rt.type_name,
          rt.capacity,
          rt.daily_rate,
          r.public_id,
          r.room_number,
          r.current_status,
          r.booking_availability
        FROM room r
        JOIN branch b ON b.branch_id = r.branch_id
        JOIN room_type rt ON rt.room_type_id = r.room_type_id
        WHERE 1 = 1 ${availabilityFilter}
        ORDER BY b.name, r.room_number
      `,
      parameters,
    );

    res.json({ data: rows });
  } catch (error) {
    next(error);
  }
});

router.get('/bookings', async (req, res, next) => {
  try {
    const parameters = [];
    const filters = [];

    if (req.query.status) {
      parameters.push(req.query.status);
      filters.push('b.booking_status = ?');
    }

    const [rows] = await pool.execute(
      `
        SELECT
          CONCAT(g.first_name, ' ', g.last_name) AS guest_name,
          g.email AS guest_email,
          b.booking_reference,
          b.public_id,
          GROUP_CONCAT(DISTINCT br_branch.name ORDER BY br_branch.name) AS branch_names,
          b.booking_time,
          b.check_in_time,
          b.check_out_time,
          b.cancellation_time,
          b.booking_status,
          b.payment_status,
          b.total_charge,
          b.outstanding_amount,
          b.total_tax_amount,
          GROUP_CONCAT(DISTINCT r.room_number ORDER BY r.room_number) AS room_numbers
        FROM booking b
        JOIN guest g ON g.guest_id = b.guest_id
        LEFT JOIN booking_room br ON br.booking_id = b.booking_id
        LEFT JOIN room r ON r.room_id = br.room_id
        LEFT JOIN branch br_branch ON br_branch.branch_id = r.branch_id
        ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
        GROUP BY b.booking_id, b.booking_reference, g.first_name, g.last_name, g.email
        ORDER BY b.check_in_time DESC
      `,
      parameters,
    );

    res.json({ data: rows });
  } catch (error) {
    next(error);
  }
});

//TESTING TRIGGERS AND PROCEDURES 

router.post('/calculate-bill', async (req, res, next) => {
  const bookingPublicId = req.body?.booking_public_id;
  if (typeof bookingPublicId !== 'string' || !bookingPublicId.trim()) {
    res.status(400).json({ error: 'booking_public_id must be a UUID' });
    return;
  }

  let connection;
  try {
    connection = await pool.getConnection();
    // The procedure locks the booking until this transaction is committed.
    await connection.beginTransaction();
    const [bookingRows] = await connection.execute(
      'SELECT booking_id FROM booking WHERE public_id = ? FOR UPDATE',
      [bookingPublicId],
    );
    if (!bookingRows.length) {
      res.status(404).json({ error: 'Booking not found' });
      await connection.rollback();
      return;
    }
    const bookingId = bookingRows[0].booking_id;
    await connection.execute('CALL sp_calculate_bill(?)', [bookingId]);
    const [rows] = await connection.execute(
      `SELECT public_id, total_charge, total_tax_amount,
        outstanding_amount, credit_amount, payment_status
       FROM booking WHERE booking_id = ?`,
      [bookingId],
    );
    await connection.commit();
    res.json({ data: rows[0] });
  } catch (error) {
    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        next(rollbackError);
        return;
      }
    }
    if (error.sqlState === '45000' && error.sqlMessage === 'Booking not found') {
      res.status(404).json({ error: 'Booking not found' });
      return;
    }
    next(error);
  } finally {
    connection?.release();
  }
});

//Booking cancellation - With trigger
router.post('/cancel-booking', async (req, res, next) => {
  const bookingPublicId = req.body?.booking_public_id;
  if (typeof bookingPublicId !== 'string' || !bookingPublicId.trim()) {
    res.status(400).json({ error: 'booking_public_id must be a UUID' });
    return;
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    // The cancellation procedure also recalculates the bill.
    const [bookingRows] = await connection.execute(
      'SELECT booking_id FROM booking WHERE public_id = ? FOR UPDATE',
      [bookingPublicId],
    );
    if (!bookingRows.length) {
      res.status(404).json({ error: 'Booking not found' });
      await connection.rollback();
      return;
    }
    const bookingId = bookingRows[0].booking_id;
    await connection.execute('CALL sp_cancel_booking(?)', [bookingId]);
    const [rows] = await connection.execute(
      `SELECT public_id, booking_status, cancellation_time,
        cancellation_fee, cancellation_tax_amount, cancellation_charge_services,
        total_charge, total_tax_amount, outstanding_amount, credit_amount, payment_status
       FROM booking WHERE booking_id = ?`,
      [bookingId],
    );
    await connection.commit();
    res.json({ data: rows[0] });
  } catch (error) {
    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        next(rollbackError);
        return;
      }
    }
    if (error.sqlState === '45000') {
      const statusByMessage = new Map([
        ['Booking not found', 404],
        ['Only Booked reservations can be cancelled', 409],
        ['Cancellation policy is not configured for this notice period', 409],
      ]);
      const status = statusByMessage.get(error.sqlMessage);
      if (status) {
        res.status(status).json({ error: error.sqlMessage });
        return;
      }
    }
    next(error);
  } finally {
    connection?.release();
  }
});
// End of booking cancellation - With trigger
router.get('/reports/occupancy', async (req, res, next) => {
  try {
    const from = parseDate(req.query.from, 'from');
    const to = parseDate(req.query.to, 'to');
    const [rows] = await pool.execute(
      `
        SELECT room_public_id, branch_public_id, booking_public_id,
          room_number, branch_name, type_name,
          check_in_time, check_out_time, booking_status
        FROM report_occupancy
        WHERE booking_id IS NULL
          OR (
            booking_status IN ('Booked', 'Checked-In')
            AND check_in_time < ? AND check_out_time > ?
          )
        ORDER BY branch_id, room_number
      `,
      [to, from],
    );

    res.json({ data: rows, from, to });
  } catch (error) {
    next(error);
  }
});

router.get('/reports/billing', async (req, res, next) => {
  try {
    const [rows] = await pool.execute(`
      SELECT guest_public_id, booking_public_id, guest_name, booking_status, payment_status,
        total_charge, paid_amount, calculated_outstanding_amount
      FROM report_guest_billing
      ORDER BY calculated_outstanding_amount DESC
    `);

    res.json({ data: rows });
  } catch (error) {
    next(error);
  }
});

router.get('/reports/service-usage', async (req, res, next) => {
  try {
    const parameters = [];
    const filters = [];

    if (req.query.from) {
      parameters.push(parseDate(req.query.from, 'from'));
      filters.push('usage_time >= ?');
    }
    if (req.query.to) {
      parameters.push(parseDate(req.query.to, 'to'));
      filters.push('usage_time < ?');
    }

    const [rows] = await pool.execute(
      `
        SELECT room_public_id, service_public_id, booking_public_id,
          room_number, service_name,
          SUM(quantity) AS total_quantity,
          SUM(line_total) AS total_amount
        FROM report_service_usage
        ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
        GROUP BY room_public_id, service_public_id, booking_public_id, room_number, service_name
        ORDER BY total_quantity DESC, total_amount DESC
      `,
      parameters,
    );

    res.json({ data: rows });
  } catch (error) {
    next(error);
  }
});

router.get('/reports/revenue', async (req, res, next) => {
  try {
    const from = parseDate(req.query.from, 'from');
    const to = parseDate(req.query.to, 'to');
    const [rows] = await pool.execute(
      `
        SELECT branch_public_id, branch_name,
          SUM(room_and_tax_revenue) AS room_and_tax_revenue,
          SUM(service_revenue) AS service_revenue
        FROM report_revenue
        WHERE check_in_time < ? AND check_out_time > ?
        GROUP BY branch_public_id, branch_name
        ORDER BY branch_name
      `,
      [to, from],
    );

    res.json({ data: rows, from, to });
  } catch (error) {
    next(error);
  }
});

router.get('/reports/top-services', async (req, res, next) => {
  try {
    const [rows] = await pool.execute(`
      SELECT service_public_id, service_name, total_quantity, booking_count, total_revenue
      FROM report_top_services
      ORDER BY total_quantity DESC, total_revenue DESC
    `);

    res.json({ data: rows });
  } catch (error) {
    next(error);
  }
});

export default router;
