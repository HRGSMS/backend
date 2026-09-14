import express from 'express';
import cors from 'cors';
import helmet from 'helmet';

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(express.json());

  // Health check — confirms the server is up and responding
  app.get('/api/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  // TODO: mount module routers here as each one is built
  // app.use('/api/auth', authRoutes);
  // app.use('/api/bookings', bookingRoutes);


  return app;
}