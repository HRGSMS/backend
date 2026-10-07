import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import authRoutes from './modules/auth/routes.js';

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true,
  }));
  app.use(express.json());

  // Health check — confirms the server is up and responding
  app.get('/api/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  // Auth routes
  app.use('/api/auth', authRoutes);

  // TODO: mount other module routers here as each one is built
  // app.use('/api/bookings', bookingRoutes);


  return app;
}