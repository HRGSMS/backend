import 'dotenv/config';
import http from 'http';
import { createApp } from './app.js';

const app = createApp();
const server = http.createServer(app);

const PORT = process.env.PORT || 4000;

server.listen(PORT, () => {
  console.log(`HRGSMS backend running on http://localhost:${PORT}`);
});

// TODO: initialize Socket.io
// import { initSockets } from './sockets/index.js';
// initSockets(server);