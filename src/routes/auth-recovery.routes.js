import { Router } from 'express';
import { pool } from '../config/db.js';
import { auth } from '../lib/auth.js';

const router = Router();

function validationError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

/**
 * POST /api/auth/forgot-password
 *
 * Checks database user table for the given email, triggers Better Auth's
 * password reset workflow, and retrieves the generated verification token
 * from the database verification table.
 */
router.post('/forgot-password', async (req, res, next) => {
  try {
    const email = req.body?.email;
    if (typeof email !== 'string' || !email.trim()) {
      throw validationError('Please provide a valid email address');
    }
    const cleanEmail = email.trim().toLowerCase();

    // Verify user exists in the database
    const [userRows] = await pool.execute(
      'SELECT id, name, email, role FROM `user` WHERE LOWER(email) = ?',
      [cleanEmail],
    );

    if (!userRows.length) {
      throw validationError('No registered user found with that email address', 404);
    }

    const user = userRows[0];

    // Trigger Better Auth password reset workflow
    await auth.api.requestPasswordReset({
      body: { email: user.email },
    });

    // Query the database verification table to fetch the active reset token
    const [verifRows] = await pool.execute(
      `SELECT identifier, expiresAt FROM verification
       WHERE value = ? AND identifier LIKE 'reset-password:%'
       ORDER BY createdAt DESC LIMIT 1`,
      [user.id],
    );

    const token = verifRows[0]?.identifier
      ? verifRows[0].identifier.replace('reset-password:', '')
      : null;

    res.status(200).json({
      status: true,
      message: 'Password reset token generated successfully. You can now set your new password.',
      data: {
        email: user.email,
        name: user.name,
        role: user.role,
        token,
        expires_at: verifRows[0]?.expiresAt,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/auth/reset-password-direct
 *
 * Validates the reset token from database verification table,
 * applies the new password to account table via Better Auth,
 * and clears the token.
 */
router.post('/reset-password-direct', async (req, res, next) => {
  try {
    const token = req.body?.token;
    const newPassword = req.body?.newPassword;

    if (typeof token !== 'string' || !token.trim()) {
      throw validationError('Reset token is required');
    }
    if (typeof newPassword !== 'string' || newPassword.length < 8) {
      throw validationError('New password must be at least 8 characters long');
    }

    // Verify token exists in database verification table
    const [verifRows] = await pool.execute(
      'SELECT id, value, expiresAt FROM verification WHERE identifier = ?',
      [`reset-password:${token.trim()}`],
    );

    if (!verifRows.length) {
      throw validationError('Invalid or expired password reset token', 400);
    }

    const expiresAt = new Date(verifRows[0].expiresAt);
    if (expiresAt < new Date()) {
      await pool.execute('DELETE FROM verification WHERE id = ?', [verifRows[0].id]);
      throw validationError('This reset token has expired. Please request a new one.', 400);
    }

    // Apply the new password via Better Auth
    await auth.api.resetPassword({
      body: {
        token: token.trim(),
        newPassword,
      },
    });

    res.status(200).json({
      status: true,
      message: 'Password successfully updated! You can now sign in with your new password.',
    });
  } catch (error) {
    next(error);
  }
});

export default router;
