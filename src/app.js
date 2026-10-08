import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { toNodeHandler } from 'better-auth/node';
import { auth } from './lib/auth.js';

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors());

  // Better Auth must receive the raw request body before JSON parsing.
  app.all('/api/auth/*splat', toNodeHandler(auth));
  app.use(express.json());

  // Health check — confirms the server is up and responding
  app.get('/api/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  // TODO: mount module routers here as each one is built
  // app.use('/api/bookings', bookingRoutes);

  return app;
}
