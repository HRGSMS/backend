import { randomUUID } from 'node:crypto';
import { pool } from '../config/db.js';

/**
 * Requires a guest session and resolves the linked hotel guest record.
 * Automatically self-heals unlinked accounts by looking up or provisioning
 * the matching guest record from MySQL.
 *
 * @param {import('express').Request} req Incoming request.
 * @param {import('express').Response} res Outgoing response.
 * @param {import('express').NextFunction} next Express continuation.
 * @returns {Promise<void>}
 */
export async function requireGuest(req, res, next) {
  try {
    const user = req.auth?.user;
    if (!user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const guestPublicId = user.guestPublicId;

    // 1. If guestPublicId is present, verify and attach req.guest
    if (guestPublicId) {
      const [rows] = await pool.execute(
        'SELECT guest_id, public_id, first_name, last_name, email, phone_number FROM guest WHERE public_id = ?',
        [guestPublicId],
      );
      if (rows.length) {
        req.guest = rows[0];
        return next();
      }
    }

    // 2. Self-healing fallback: lookup guest by user's email
    if (user.email) {
      const [emailRows] = await pool.execute(
        'SELECT guest_id, public_id, first_name, last_name, email, phone_number FROM guest WHERE email = ?',
        [user.email],
      );
      if (emailRows.length) {
        req.guest = emailRows[0];
        await pool
          .execute('UPDATE `user` SET guestPublicId = ?, role = "guest" WHERE id = ?', [
            emailRows[0].public_id,
            user.id,
          ])
          .catch(() => null);
        return next();
      }

      // 3. Auto-provision guest profile if not found
      const [nextIds] = await pool.execute(
        'SELECT COALESCE(MAX(guest_id), 0) + 1 AS next_id FROM guest',
      );
      const newPublicId = randomUUID();
      const names = (user.name || 'Guest User').trim().split(/\s+/);
      const firstName = (names[0] || 'Guest').slice(0, 20);
      const lastName = (names.slice(1).join(' ') || 'User').slice(0, 20);

      await pool.execute(
        `INSERT INTO guest (guest_id, public_id, first_name, last_name, email, phone_number)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [nextIds[0].next_id, newPublicId, firstName, lastName, user.email, ''],
      );

      await pool
        .execute('UPDATE `user` SET guestPublicId = ?, role = "guest" WHERE id = ?', [
          newPublicId,
          user.id,
        ])
        .catch(() => null);

      req.guest = {
        guest_id: nextIds[0].next_id,
        public_id: newPublicId,
        first_name: firstName,
        last_name: lastName,
        email: user.email,
        phone_number: '',
      };
      return next();
    }

    if (user.role !== 'guest') {
      res.status(403).json({ error: 'Guest access required' });
      return;
    }

    res.status(403).json({ error: 'Guest account is not linked to a guest profile' });
  } catch (error) {
    next(error);
  }
}
