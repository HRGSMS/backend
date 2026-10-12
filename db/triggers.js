// All MySQL automation lives here. Run through db:init, never per HTTP request.
// mysql2 sends each complete CREATE statement; DELIMITER is a mysql CLI command.

const calculateBill = `
  CREATE PROCEDURE sp_calculate_bill(IN p_booking_id INT)
  SQL SECURITY INVOKER
  BEGIN
    DECLARE v_status VARCHAR(15);
    DECLARE v_nights INT;
    DECLARE v_rate DECIMAL(10,4) DEFAULT 0;
    DECLARE v_room DECIMAL(14,2) DEFAULT 0;
    DECLARE v_service DECIMAL(14,2) DEFAULT 0;
    DECLARE v_tax DECIMAL(14,2) DEFAULT 0;
    DECLARE v_paid DECIMAL(14,2) DEFAULT 0;
    DECLARE v_total DECIMAL(14,2) DEFAULT 0;
    DECLARE v_fee DECIMAL(14,2) DEFAULT 0;
    DECLARE v_fee_tax DECIMAL(14,2) DEFAULT 0;
    DECLARE v_charge_services BOOLEAN DEFAULT FALSE;
    DECLARE v_found BOOLEAN DEFAULT TRUE;
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_found = FALSE;

    -- Caller owns the transaction and serializes every billing write on this row.
    SELECT booking_status, GREATEST(DATEDIFF(check_out_time, check_in_time), 1),
      COALESCE(tax_rate_at_booking, 0), cancellation_fee, cancellation_tax_amount,
      cancellation_charge_services
    INTO v_status, v_nights, v_rate, v_fee, v_fee_tax, v_charge_services
    FROM booking WHERE booking_id = p_booking_id FOR UPDATE;
    IF NOT v_found THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Booking not found';
    END IF;

    SELECT COALESCE(SUM(nightly_rate_at_booking * v_nights), 0)
      INTO v_room FROM booking_room WHERE booking_id = p_booking_id;
    SELECT COALESCE(SUM(quantity * price_at_usage), 0),
      COALESCE(SUM(ROUND(quantity * price_at_usage * tax_rate_at_usage, 2)), 0)
      INTO v_service, v_tax FROM service_usage WHERE booking_id = p_booking_id;
    IF v_status = 'Cancelled' THEN
      SET v_room = v_fee;
      IF NOT v_charge_services THEN
        SET v_service = 0;
        SET v_tax = 0;
      END IF;
      SET v_tax = v_tax + v_fee_tax;
    ELSE
      SET v_tax = v_tax + ROUND(v_room * v_rate, 2);
    END IF;
    SELECT COALESCE(SUM(amount), 0) INTO v_paid
      FROM payment WHERE booking_id = p_booking_id;
    SET v_total = v_room + v_service + v_tax;
    UPDATE booking SET total_charge = v_total, total_tax_amount = v_tax,
      outstanding_amount = GREATEST(v_total - v_paid, 0),
      credit_amount = GREATEST(v_paid - v_total, 0),
      payment_status = CASE
        WHEN v_paid > v_total THEN 'Credit Due'
        WHEN v_paid = v_total THEN 'Paid'
        WHEN v_paid > 0 THEN 'Partially Paid'
        ELSE 'Unpaid' END
    WHERE booking_id = p_booking_id;
  END
`;

const cancelBooking = `
  CREATE PROCEDURE sp_cancel_booking(IN p_booking_id INT)
  SQL SECURITY INVOKER
  BEGIN
    DECLARE v_status VARCHAR(15);
    DECLARE v_check_in DATETIME;
    DECLARE v_check_out DATETIME;
    DECLARE v_now DATETIME;
    DECLARE v_rule INT;
    DECLARE v_type VARCHAR(20);
    DECLARE v_value DECIMAL(12,4);
    DECLARE v_rate DECIMAL(10,4);
    DECLARE v_services BOOLEAN;
    DECLARE v_nightly DECIMAL(14,2);
    DECLARE v_fee DECIMAL(14,2);
    DECLARE v_found BOOLEAN DEFAULT TRUE;
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_found = FALSE;
    SELECT booking_status, check_in_time, check_out_time
      INTO v_status, v_check_in, v_check_out
      FROM booking WHERE booking_id = p_booking_id FOR UPDATE;
    IF NOT v_found THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Booking not found';
    END IF;
    IF v_status <> 'Booked' THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Only Booked reservations can be cancelled';
    END IF;
    SET v_now = CURRENT_TIMESTAMP;
    SELECT rule_id, fee_type, fee_value, tax_rate, charge_services
      INTO v_rule, v_type, v_value, v_rate, v_services
      FROM cancellation_policy
      WHERE minimum_notice_hours * 3600 <= GREATEST(TIMESTAMPDIFF(SECOND, v_now, v_check_in), 0)
      ORDER BY minimum_notice_hours DESC LIMIT 1 FOR SHARE;
    IF NOT v_found THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Cancellation policy is not configured for this notice period';
    END IF;
    SELECT COALESCE(SUM(nightly_rate_at_booking), 0) INTO v_nightly
      FROM booking_room WHERE booking_id = p_booking_id;
    SET v_fee = ROUND(CASE v_type
      WHEN 'percentage' THEN v_nightly * GREATEST(DATEDIFF(v_check_out, v_check_in), 1) * v_value
      WHEN 'first_night' THEN v_nightly
      ELSE v_value END, 2);
    UPDATE booking SET booking_status = 'Cancelled', cancellation_time = v_now,
      cancellation_rule_id = v_rule, cancellation_fee = v_fee,
      cancellation_tax_amount = ROUND(v_fee * v_rate, 2),
      cancellation_charge_services = v_services
      WHERE booking_id = p_booking_id;
    CALL sp_calculate_bill(p_booking_id);
  END
`;

// Each rule runs before both INSERT and UPDATE. NEW contains the values being saved.
const validationTriggers = [
  // Validate booking dates/status and fill missing tax.
  {
    name: 'booking_validate',
    table: 'booking',
    body: `
    IF NEW.check_in_time IS NULL OR NEW.check_out_time IS NULL
      OR NEW.check_out_time <= NEW.check_in_time THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Checkout must be after check-in';
    END IF;
    IF NEW.booking_status IS NULL OR NEW.booking_status NOT IN ('Booked', 'Checked-In', 'Checked-Out', 'Cancelled') THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Invalid booking status';
    END IF;
    IF NEW.tax_rate_at_booking IS NULL THEN
      SET NEW.tax_rate_at_booking = COALESCE((SELECT rate FROM tax_rate WHERE tax_id = NEW.tax_id), 0);
    END IF;
    IF NEW.tax_rate_at_booking < 0 OR NEW.tax_rate_at_booking > 1 THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Tax rate must be between zero and one';
    END IF;
  `,
  },
  // Save the nightly rate and calculate the full stay price.
  {
    name: 'booking_room_price',
    table: 'booking_room',
    body: `
    IF NEW.nightly_rate_at_booking IS NULL THEN
      SET NEW.nightly_rate_at_booking = (SELECT rt.daily_rate FROM room r
        JOIN room_type rt ON rt.room_type_id = r.room_type_id WHERE r.room_id = NEW.room_id);
    END IF;
    IF NEW.nightly_rate_at_booking IS NULL OR NEW.nightly_rate_at_booking < 0 THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Room rate must be nonnegative';
    END IF;
    SET NEW.price_at_booking = NEW.nightly_rate_at_booking * (
      SELECT GREATEST(DATEDIFF(check_out_time, check_in_time), 1)
      FROM booking WHERE booking_id = NEW.booking_id);
  `,
  },
  // Validate service usage and fill missing price/tax.
  {
    name: 'service_usage_validate',
    table: 'service_usage',
    body: `
    IF NEW.quantity IS NULL OR NEW.quantity <= 0 THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Service quantity must be positive';
    END IF;
    IF NEW.price_at_usage IS NULL THEN
      SET NEW.price_at_usage = (SELECT current_price FROM service_catalogue WHERE service_id = NEW.service_id);
    END IF;
    IF NEW.tax_rate_at_usage IS NULL THEN
      SET NEW.tax_rate_at_usage = COALESCE((SELECT t.rate FROM service_catalogue s
        LEFT JOIN tax_rate t ON t.tax_id = s.tax_id WHERE s.service_id = NEW.service_id), 0);
    END IF;
    IF NEW.price_at_usage IS NULL OR NEW.price_at_usage < 0
      OR NEW.tax_rate_at_usage < 0 OR NEW.tax_rate_at_usage > 1 THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Invalid service price or tax';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM booking_room WHERE booking_id = NEW.booking_id AND room_id = NEW.room_id) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Service room must belong to the booking';
    END IF;
  `,
  },
  // Payments must have a positive amount.
  {
    name: 'payment_validate',
    table: 'payment',
    body: `
    IF NEW.amount IS NULL OR NEW.amount <= 0 THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Payment amount must be positive';
    END IF;
  `,
  },
];

// These two tables also record when their price changes.
const priceTriggers = [
  { table: 'room_type', price: 'daily_rate', timestamp: 'rate_update_time' },
  { table: 'service_catalogue', price: 'current_price', timestamp: 'price_update_time' },
];

function priceTriggerBody({ price, timestamp }, event) {
  let updateTimestamp = `SET NEW.${timestamp} = COALESCE(NEW.${timestamp}, CURRENT_TIMESTAMP);`;
  if (event === 'UPDATE') {
    // <=> compares values safely even when one is NULL.
    updateTimestamp = `
      IF NOT (NEW.${price} <=> OLD.${price}) THEN
        SET NEW.${timestamp} = CURRENT_TIMESTAMP;
      END IF;
    `;
  }

  return `
    IF NEW.${price} IS NULL OR NEW.${price} < 0 THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Price must be nonnegative';
    END IF;
    ${updateTimestamp}
  `;
}

async function installTrigger(connection, name, table, event, body) {
  const triggerName = `${name}_${event.toLowerCase()}`;
  await connection.query(`DROP TRIGGER IF EXISTS ${triggerName}`);
  await connection.query(`
    CREATE TRIGGER ${triggerName} BEFORE ${event} ON ${table}
    FOR EACH ROW
    BEGIN
      ${body}
    END
  `);
}

// Install once during db:init. Procedures are called explicitly; triggers run automatically.
export async function installTriggers(connection) {
  for (const [name, sql] of [
    ['sp_calculate_bill', calculateBill],
    ['sp_cancel_booking', cancelBooking],
  ]) {
    await connection.query(`DROP PROCEDURE IF EXISTS ${name}`);
    await connection.query(sql);
  }
  for (const event of ['INSERT', 'UPDATE']) {
    for (const { name, table, body } of validationTriggers) {
      await installTrigger(connection, name, table, event, body);
    }
    for (const rule of priceTriggers) {
      await installTrigger(
        connection,
        `${rule.table}_price`,
        rule.table,
        event,
        priceTriggerBody(rule, event),
      );
    }
  }
}
