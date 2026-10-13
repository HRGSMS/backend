import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { toNodeHandler } from 'better-auth/node';
import { auth } from './lib/auth.js';
import dataRoutes from './routes/data.routes.js';
import writeRoutes from './routes/write.routes.js';
import guestRoutes from './routes/guest.routes.js';
import guestAuthRoutes from './routes/guest-auth.routes.js';
import { requireAuth, optionalAuth } from './middleware/require-auth.middleware.js';

export function createApp() {
  const app = express();

  app.use(helmet());
  // CORS config for frontend with credentials
  app.use(
    cors({
      origin: process.env.FRONTEND_URL || [
        'http://localhost:5173',
        'http://127.0.0.1:5173',
        'http://localhost:4000',
      ],
      credentials: true, // IMPORTANT: Allow cookies
    }),
  );

  app.use('/api/auth/guest-sign-up', express.json(), guestAuthRoutes);

  // Better Auth must receive the raw request body before JSON parsing.
  app.all('/api/auth/*splat', toNodeHandler(auth));
  app.use(express.json());

  // Health check — confirms the server is up and responding
  app.get('/api/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  // Public read routes used by the guest-facing portal (no auth required)
  const PUBLIC_GET_PATHS = [
    /^\/rooms\/?$/,
    /^\/hotel-config\/?$/,
    /^\/payment-methods\/?$/,
  ];

  app.use(
    '/api',
    (req, res, next) => {
      if (req.method === 'GET' && PUBLIC_GET_PATHS.some((re) => re.test(req.path))) {
        return optionalAuth(req, res, next);
      }
      return requireAuth(req, res, next);
    },
    dataRoutes,
  );
  app.use('/api', requireAuth, writeRoutes);
  app.use('/api/guest', requireAuth, guestRoutes);

  app.use((error, req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }

    const statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 500;
    console.error(error);
    res.status(statusCode).json({
      error: statusCode === 500 ? 'Internal server error' : error.message,
    });
  });

  return app;
}
