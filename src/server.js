import 'dotenv/config';
import http from 'http';
import { createApp } from './app.js';
import { connectToDatabase } from './config/db.js';
import { initSockets } from './sockets/index.js';

const app = createApp();
const server = http.createServer(app);

const PORT = process.env.PORT || 4000;

async function startServer() {
  try {
    await connectToDatabase();
    initSockets(server);

    server.listen(PORT, () => {
      console.log(`HRGSMS backend running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('Unable to connect to MySQL:', error.message);
    process.exitCode = 1;
  }
}

startServer();
