import express from 'express';
import { auth } from '../../config/auth.js';

const router = express.Router();

// Mount BetterAuth handlers
router.all('/sign-in/email', (req, res) => auth.handler(req, res));
router.all('/sign-up/email', (req, res) => auth.handler(req, res));
router.all('/sign-out', (req, res) => auth.handler(req, res));
router.all('/session', (req, res) => auth.handler(req, res));
router.all('/forget-password', (req, res) => auth.handler(req, res));
router.all('/reset-password', (req, res) => auth.handler(req, res));
router.all('/verify-email', (req, res) => auth.handler(req, res));
router.all('/social/*', (req, res) => auth.handler(req, res));

// Custom endpoint to get current user with role
router.get('/me', async (req, res) => {
  try {
    const session = await auth.api.getSession({
      headers: req.headers,
    });

    if (!session) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    res.json({
      user: {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
        role: session.user.role,
        branchId: session.user.branchId,
        image: session.user.image,
        emailVerified: session.user.emailVerified,
        createdAt: session.user.createdAt,
      },
      session: {
        expiresAt: session.session.expiresAt,
        token: session.session.token,
      },
    });
  } catch (error) {
    console.error('Get session error:', error);
    res.status(500).json({ error: 'Failed to get session' });
  }
});

// Custom endpoint for role-based redirect info
router.get('/redirect', async (req, res) => {
  try {
    const session = await auth.api.getSession({
      headers: req.headers,
    });

    if (!session) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const role = session.user.role;
    let redirectPath = '/frontdesk/dashboard';

    switch (role) {
      case 'Manager':
      case 'Admin':
        redirectPath = '/manager/dashboard';
        break;
      case 'FrontDesk':
      default:
        redirectPath = '/frontdesk/dashboard';
        break;
    }

    res.json({
      redirectPath,
      role,
      user: {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
      },
    });
  } catch (error) {
    console.error('Get redirect error:', error);
    res.status(500).json({ error: 'Failed to get redirect' });
  }
});

export default router;