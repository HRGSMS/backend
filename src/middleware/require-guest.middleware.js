import { pool } from '../config/db.js';

/**
 * Requires a guest role and resolves the linked hotel guest record.
 *
 * @param {import('express').Request} req Incoming request.
 * @param {import('express').Response} res Outgoing response.
 * @param {import('express').NextFunction} next Express continuation.
 * @returns {Promise<void>}
 */
export async function requireGuest(req, res, next) {
  try {
    if (req.auth?.user?.role !== 'guest') {
      res.status(403).json({ error: 'Guest access required' });
      return;
    }

    const guestPublicId = req.auth.user.guestPublicId;
    if (!guestPublicId) {
      res.status(403).json({ error: 'Guest account is not linked to a guest profile' });
      return;
    }

    const [rows] = await pool.execute('SELECT guest_id, public_id FROM guest WHERE public_id = ?', [
      guestPublicId,
    ]);
    if (!rows.length) {
      res.status(403).json({ error: 'Linked guest profile does not exist' });
      return;
    }

    req.guest = rows[0];
    next();
  } catch (error) {
    next(error);
  }
}
