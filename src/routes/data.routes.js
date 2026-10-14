import { Router } from 'express';
import { pool } from '../config/db.js';
import { requireRole } from '../middleware/require-role.middleware.js';
import { notifyStaff } from '../sockets/index.js';

const router = Router();
const staffRoles = requireRole('admin', 'manager', 'front_desk');
const managementRoles = requireRole('admin', 'manager');
const allStaffRoles = requireRole('admin', 'manager', 'front_desk', 'service_staff');

router.use((req, res, next) => {
  const identifierQuery = Object.keys(req.query).find(
    (key) => !key.endsWith('_public_id') && (key === 'id' || key === 'ids' || key.endsWith('_id')),
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
  listTable(
    req,
    res,
    next,
    'amenity',
    'public_id, amenity_name, amenity_description',
    'amenity_id',
  ),
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

      parameters.push(availableTo, availableFrom);
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
          b.public_id   AS branch_public_id,
          b.name        AS branch_name,
          rt.type_name,
          rt.capacity,
          rt.daily_rate,
          r.public_id,
          r.room_number,
          r.current_status,
          r.booking_availability,
          COALESCE(
            GROUP_CONCAT(
              DISTINCT a.amenity_name
              ORDER BY a.amenity_name
              SEPARATOR ', '
            ),
            ''
          ) AS amenities
        FROM room r
        JOIN branch b   ON b.branch_id       = r.branch_id
        JOIN room_type rt ON rt.room_type_id  = r.room_type_id
        LEFT JOIN room_amenity ra       ON ra.room_type_id  = rt.room_type_id
        LEFT JOIN amenity a             ON a.amenity_id     = ra.amenity_id
        WHERE 1 = 1 ${availabilityFilter}
        GROUP BY
          r.room_id, r.public_id, r.room_number, r.current_status, r.booking_availability,
          b.public_id, b.name,
          rt.type_name, rt.capacity, rt.daily_rate
        ORDER BY b.name, r.room_number
      `,
      parameters,
    );

    res.json({ data: rows });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /hotel-config
 * Returns hotel-wide public configuration values (name, hotline, check-in/out times, etc.).
 * No authentication required — used by guest-facing pages.
 */
router.get('/hotel-config', async (req, res, next) => {
  try {
    const [rows] = await pool.execute('SELECT config_key, config_value FROM hotel_config');
    // Convert rows to a flat key→value object for easy frontend consumption
    const config = Object.fromEntries(rows.map((r) => [r.config_key, r.config_value]));
    res.json({ data: config });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /management/settings
 * Returns system settings for management and staff dashboards.
 * Accessible by all hotel staff roles.
 */
router.get('/management/settings', allStaffRoles, async (req, res, next) => {
  try {
    const [rows] = await pool.execute('SELECT config_key, config_value FROM hotel_config');
    const config = Object.fromEntries(rows.map((r) => [r.config_key, r.config_value]));

    const settings = {
      hotelName: config.hotel_name || '',
      contactEmail: config.contact_email || 'contact@skynest.page',
      contactPhone: config.hotline_number || config.contact_phone || '',
      checkInTime: config.checkin_time || '14:00',
      checkOutTime: config.checkout_time || '11:00',
      revision: Number.parseInt(config.settings_revision || '1', 10) || 1,
    };

    res.json({ data: settings });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /management/settings
 * Updates hotel operational settings in hotel_config table.
 * Restricted to administrators and managers.
 */
router.put('/management/settings', managementRoles, async (req, res, next) => {
  try {
    const { hotelName, contactEmail, contactPhone, checkInTime, checkOutTime, revision } =
      req.body || {};

    if (!hotelName || typeof hotelName !== 'string' || !hotelName.trim()) {
      const error = new Error('Hotel name is required');
      error.statusCode = 400;
      throw error;
    }
    if (!contactEmail || typeof contactEmail !== 'string' || !contactEmail.trim()) {
      const error = new Error('Contact email is required');
      error.statusCode = 400;
      throw error;
    }

    const nextRevision = (Number.parseInt(revision, 10) || 0) + 1;

    const updates = [
      ['hotel_name', hotelName.trim(), 'Public hotel brand name'],
      ['contact_email', contactEmail.trim(), 'Hotel contact email address'],
      ['hotline_number', (contactPhone || '').trim(), 'Public customer hotline number'],
      ['checkin_time', (checkInTime || '14:00').trim(), 'Standard check-in time of day'],
      ['checkout_time', (checkOutTime || '11:00').trim(), 'Standard check-out time of day'],
      ['settings_revision', String(nextRevision), 'Settings modification revision counter'],
    ];

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      for (const [key, value, desc] of updates) {
        await connection.execute(
          `INSERT INTO hotel_config (config_key, config_value, description)
           VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE config_value = VALUES(config_value), description = COALESCE(VALUES(description), description)`,
          [key, value, desc],
        );
      }
      await connection.commit();
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }

    const updatedSettings = {
      hotelName: hotelName.trim(),
      contactEmail: contactEmail.trim(),
      contactPhone: (contactPhone || '').trim(),
      checkInTime: (checkInTime || '14:00').trim(),
      checkOutTime: (checkOutTime || '11:00').trim(),
      revision: nextRevision,
    };

    notifyStaff({
      type: 'settings:updated',
      settings: updatedSettings,
    });

    res.json({ data: updatedSettings });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /payment-methods
 * Returns active payment methods from the database.
 * No authentication required — used at booking checkout and payment modals.
 */
router.get('/payment-methods', async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      'SELECT public_id, method_name, display_name FROM payment_method WHERE is_active = 1 ORDER BY method_id',
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
        GROUP BY b.booking_id, g.first_name, g.last_name, g.email
        ORDER BY b.check_in_time DESC
      `,
      parameters,
    );

    res.json({ data: rows });
  } catch (error) {
    next(error);
  }
});

router.get('/service-request-options', async (req, res, next) => {
  try {
    const [rows] = await pool.execute(`
      SELECT
        b.public_id AS booking_public_id,
        g.public_id AS guest_public_id,
        CONCAT(g.first_name, ' ', g.last_name) AS guest_name,
        r.public_id AS room_public_id,
        r.room_number,
        b.booking_status
      FROM booking b
      JOIN guest g ON g.guest_id = b.guest_id
      JOIN booking_room br ON br.booking_id = b.booking_id
      JOIN room r ON r.room_id = br.room_id
      WHERE b.booking_status = 'Checked-In'
      ORDER BY g.first_name, g.last_name, r.room_number
    `);

    res.json({ data: rows });
  } catch (error) {
    next(error);
  }
});

router.get('/service-requests', async (req, res, next) => {
  try {
    const filters = [];
    const parameters = [];
    const publicIdFilters = [
      ['booking_public_id', 'b.public_id'],
      ['room_public_id', 'r.public_id'],
      ['service_public_id', 'sc.public_id'],
    ];

    for (const [queryName, column] of publicIdFilters) {
      if (req.query[queryName] !== undefined && req.query[queryName] !== '') {
        if (typeof req.query[queryName] !== 'string' || req.query[queryName].length !== 36) {
          const error = new Error(`${queryName} must be a UUID`);
          error.statusCode = 400;
          throw error;
        }
        filters.push(`${column} = ?`);
        parameters.push(req.query[queryName]);
      }
    }

    if (req.query.status !== undefined && req.query.status !== '') {
      if (!['Pending', 'Completed'].includes(req.query.status)) {
        const error = new Error('status must be one of: Pending, Completed');
        error.statusCode = 400;
        throw error;
      }
      filters.push('su.status = ?');
      parameters.push(req.query.status);
    }

    const [rows] = await pool.execute(
      `
        SELECT
          su.public_id,
          b.public_id AS booking_public_id,
          r.public_id AS room_public_id,
          r.room_number,
          g.public_id AS guest_public_id,
          CONCAT(g.first_name, ' ', g.last_name) AS guest_name,
          sc.public_id AS service_public_id,
          sc.service_name,
          su.usage_time,
          su.quantity,
          su.price_at_usage,
          su.status
        FROM service_usage su
        JOIN service_catalogue sc ON sc.service_id = su.service_id
        JOIN room r ON r.room_id = su.room_id
        JOIN booking b ON b.booking_id = su.booking_id
        JOIN guest g ON g.guest_id = b.guest_id
        ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
        ORDER BY su.usage_time DESC, su.usage_id DESC
      `,
      parameters,
    );

    res.json({ data: rows });
  } catch (error) {
    next(error);
  }
});

router.patch('/service-requests/:publicId/complete', staffRoles, async (req, res, next) => {
  try {
    const role = req.auth?.user?.role;
    if (!['admin', 'manager', 'front_desk'].includes(role)) {
      res.status(role ? 403 : 401).json({
        error: 'You are not authorized to complete service requests',
      });

      return;
    }

    const publicId = req.params.publicId;
    if (typeof publicId !== 'string' || publicId.length !== 36) {
      res.status(400).json({ error: 'Service request public_id must be a UUID' });
      return;
    }

    const [result] = await pool.execute(
      `UPDATE service_usage
       SET status = 'Completed'
       WHERE public_id = ? AND status <> 'Completed'`,
      [publicId],
    );
    const [rows] = await pool.execute(
      'SELECT public_id, status FROM service_usage WHERE public_id = ?',
      [publicId],
    );

    if (!rows.length) {
      res.status(404).json({ error: 'Service request not found' });
      return;
    }

    res.json({
      message:
        result.affectedRows > 0
          ? 'Service request marked as completed'
          : 'Service request was already completed',
      data: rows[0],
    });
    notifyStaff({
      type: 'service_request.completed',
      message: 'A guest service request was completed',
      data: rows[0],
    });
  } catch (error) {
    next(error);
  }
});

router.delete('/service-requests/:publicId', staffRoles, async (req, res, next) => {
  let connection;
  try {
    const requestPublicId = req.params.publicId;
    if (typeof requestPublicId !== 'string' || requestPublicId.length !== 36) {
      res.status(400).json({ error: 'Service request public_id must be a UUID' });
      return;
    }

    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [requests] = await connection.execute(
      `SELECT su.usage_id, su.booking_id
       FROM service_usage su
       WHERE su.public_id = ? AND su.status = 'Pending'
       FOR UPDATE`,
      [requestPublicId],
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
      message: 'A staff member cancelled a service request',
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
    notifyStaff({
      type: 'booking.bill_recalculated',
      message: 'A booking bill was recalculated',
      data: {
        booking_public_id: bookingPublicId,
        payment_status: rows[0].payment_status,
        outstanding_amount: rows[0].outstanding_amount,
      },
    });
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
router.post('/cancel-booking', staffRoles, async (req, res, next) => {
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
    notifyStaff({
      type: 'booking.cancelled',
      message: 'A booking was cancelled',
      data: {
        booking_public_id: bookingPublicId,
        cancellation_fee: rows[0].cancellation_fee,
        payment_status: rows[0].payment_status,
      },
    });
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
    const parameters = [to, from];
    let branchFilter = '';

    if (req.query.branch_name) {
      parameters.push(req.query.branch_name);
      branchFilter = 'AND b.name = ?';
    } else if (req.query.branch_public_id) {
      parameters.push(req.query.branch_public_id);
      branchFilter = 'AND b.public_id = ?';
    }

    const [rows] = await pool.execute(
      `
        SELECT
          r.public_id AS room_public_id,
          b.public_id AS branch_public_id,
          bk.public_id AS booking_public_id,
          r.room_number,
          b.name AS branch_name,
          rt.type_name,
          bk.check_in_time,
          bk.check_out_time,
          bk.booking_status
        FROM room r
        JOIN branch b ON b.branch_id = r.branch_id
        JOIN room_type rt ON rt.room_type_id = r.room_type_id
        LEFT JOIN (
          booking_room br
          JOIN booking bk ON bk.booking_id = br.booking_id
            AND bk.booking_status IN ('Booked', 'Checked-In')
            AND bk.check_in_time < ?
            AND bk.check_out_time > ?
        ) ON br.room_id = r.room_id
        WHERE 1 = 1 ${branchFilter}
        ORDER BY b.branch_id, r.room_number
      `,
      parameters,
    );

    res.json({ data: rows, from, to });
  } catch (error) {
    next(error);
  }
});

router.get('/reports/billing', async (req, res, next) => {
  try {
    const parameters = [];
    let branchFilter = '';

    if (req.query.branch_name) {
      parameters.push(`%${req.query.branch_name}%`);
      branchFilter = 'HAVING branch_names LIKE ?';
    }

    const [rows] = await pool.execute(
      `
      SELECT
        g.public_id AS guest_public_id,
        b.public_id AS booking_public_id,
        CONCAT(g.first_name, ' ', g.last_name) AS guest_name,
        b.booking_status,
        b.payment_status,
        b.total_charge,
        COALESCE(p.paid_amount, 0) AS paid_amount,
        b.total_charge - COALESCE(p.paid_amount, 0) AS calculated_outstanding_amount,
        GROUP_CONCAT(DISTINCT br_branch.name ORDER BY br_branch.name) AS branch_names
      FROM booking b
      JOIN guest g ON g.guest_id = b.guest_id
      LEFT JOIN (
        SELECT booking_id, SUM(amount) AS paid_amount
        FROM payment
        GROUP BY booking_id
      ) p ON p.booking_id = b.booking_id
      LEFT JOIN booking_room br ON br.booking_id = b.booking_id
      LEFT JOIN room r ON r.room_id = br.room_id
      LEFT JOIN branch br_branch ON br_branch.branch_id = r.branch_id
      GROUP BY
        b.booking_id,
        b.public_id,
        g.public_id,
        g.first_name,
        g.last_name,
        b.booking_status,
        b.payment_status,
        b.total_charge,
        p.paid_amount
      ${branchFilter}
      ORDER BY calculated_outstanding_amount DESC
    `,
      parameters,
    );

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
