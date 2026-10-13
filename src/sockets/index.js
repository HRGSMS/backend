import { Server } from 'socket.io';
import { fromNodeHeaders } from 'better-auth/node';
import { auth } from '../lib/auth.js';

let io;

/**
 * Initializes authenticated Socket.io connections for staff notifications.
 *
 * @param {import('http').Server} httpServer HTTP server hosting the API.
 * @returns {Server} The initialized Socket.io server.
 */
export function initSockets(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: process.env.FRONTEND_URL || [
        'http://localhost:5173',
        'http://127.0.0.1:5173',
        'http://localhost:4000',
      ],
      credentials: true,
    },
  });

  io.use(async (socket, next) => {
    try {
      const session = await auth.api.getSession({
        headers: fromNodeHeaders(socket.handshake.headers),
      });

      if (!session) {
        next(new Error('Authentication required'));
        return;
      }

      socket.data.auth = session;
      next();
    } catch (error) {
      next(error);
    }
  });

  io.on('connection', (socket) => {
    const role = socket.data.auth.user.role;
    socket.join(`role:${role}`);
    socket.join(`user:${socket.data.auth.user.id}`);
  });

  return io;
}

/**
 * Sends a notification to authenticated staff clients.
 *
 * @param {object} notification Notification payload sent to clients.
 * @param {string} notification.type Stable event type.
 * @param {string} notification.message Human-readable notification.
 * @param {object} [notification.data] Event-specific data.
 * @returns {void}
 */
export function notifyStaff(notification) {
  if (!io) {
    return;
  }

  io.to('role:admin')
    .to('role:manager')
    .to('role:front_desk')
    .emit('notification', {
      ...notification,
      created_at: new Date().toISOString(),
    });
}
