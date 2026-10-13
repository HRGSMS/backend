import { fromNodeHeaders } from 'better-auth/node';
import { auth } from '../lib/auth.js';

/**
 * Requires a valid Better Auth session for a protected API request.
 *
 * @param {import('express').Request} req Incoming Express request.
 * @param {import('express').Response} res Outgoing Express response.
 * @param {import('express').NextFunction} next Express continuation callback.
 * @returns {Promise<void>} Resolves after the request is authorized or rejected.
 */
export async function requireAuth(req, res, next) {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });

    if (!session) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    req.auth = session;
    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Populates req.auth if a valid Better Auth session is present,
 * but allows unauthenticated requests to proceed.
 *
 * @param {import('express').Request} req Incoming Express request.
 * @param {import('express').Response} res Outgoing Express response.
 * @param {import('express').NextFunction} next Express continuation callback.
 * @returns {Promise<void>} Resolves after checking session.
 */
export async function optionalAuth(req, res, next) {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });

    if (session) {
      req.auth = session;
    }

    next();
  } catch {
    next();
  }
}
