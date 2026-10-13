import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { betterAuth } from 'better-auth';
import { pool } from '../config/db.js';
import { authOptions } from '../lib/auth.js';

const router = Router();

function validationError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function requiredString(value, name, maxLength) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength) {
    throw validationError(`${name} must be a non-empty string of at most ${maxLength} characters`);
  }
  return value.trim();
}

/**
 * Registers a guest account and its linked hotel guest profile.
 *
 * Authentication data is created by Better Auth; first/last name and phone
 * are stored only in the hotel guest table.
 */
router.post('/', async (req, res, next) => {
  let userId;
  let connection;

  try {
    const firstName = requiredString(req.body?.first_name, 'first_name', 20);
    const lastName = requiredString(req.body?.last_name, 'last_name', 20);
    const email = requiredString(req.body?.email, 'email', 255);
    const phoneNumber = requiredString(req.body?.phone_number, 'phone_number', 20);
    const password = requiredString(req.body?.password, 'password', 128);

    const bootstrapAuth = betterAuth({
      ...authOptions,
      emailAndPassword: {
        ...authOptions.emailAndPassword,
        disableSignUp: false,
      },
    });
    const signup = await bootstrapAuth.api.signUpEmail({
      body: {
        name: 'Guest',
        email,
        password,
      },
    });

    userId = signup?.user?.id;
    if (!userId) {
      throw validationError('Guest account could not be created');
    }

    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [existingGuests] = await connection.execute(
      'SELECT guest_id FROM guest WHERE email = ? FOR UPDATE',
      [email],
    );
    if (existingGuests.length) {
      throw validationError('A guest profile with that email already exists');
    }

    const [nextIds] = await connection.execute(
      'SELECT COALESCE(MAX(guest_id), 0) + 1 AS next_id FROM guest FOR UPDATE',
    );
    const guestPublicId = randomUUID();
    await connection.execute(
      `INSERT INTO guest
       (guest_id, public_id, first_name, last_name, email, phone_number)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [nextIds[0].next_id, guestPublicId, firstName, lastName, email, phoneNumber],
    );
    await connection.execute('UPDATE `user` SET role = ?, guestPublicId = ? WHERE id = ?', [
      'guest',
      guestPublicId,
      userId,
    ]);
    await connection.commit();

    res.status(201).json({
      data: {
        email,
        guest_public_id: guestPublicId,
        role: 'guest',
      },
    });
  } catch (error) {
    if (connection) {
      await connection.rollback();
    }
    if (userId) {
      await pool.execute('DELETE FROM session WHERE userId = ?', [userId]);
      await pool.execute('DELETE FROM account WHERE userId = ?', [userId]);
      await pool.execute('DELETE FROM `user` WHERE id = ?', [userId]);
    }
    if (error.statusCode) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    if (error.code === 'ER_DUP_ENTRY') {
      res.status(409).json({ error: 'An account with that email already exists' });
      return;
    }
    next(error);
  } finally {
    connection?.release();
  }
});

export default router;
