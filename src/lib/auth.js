import { betterAuth } from 'better-auth';
import { admin } from 'better-auth/plugins';
import { pool } from '../config/db.js';

/**
 * Better Auth server configuration backed by the existing MySQL database.
 *
 * Public sign-up is disabled so only an authenticated admin can create users
 * through the admin plugin's `/admin/create-user` endpoint.
 */
export const authOptions = {
  database: pool,
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL || `http://localhost:${process.env.PORT || 4000}`,
  trustedOrigins: [
    ...(process.env.FRONTEND_URL ? [process.env.FRONTEND_URL] : []),
    'http://localhost:5173', // Frontend dev server
    'http://localhost:4000', // Backend itself (for Postman/testing)
    'http://127.0.0.1:5173', // Alternative localhost
  ],
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
  },
  user: {
    additionalFields: {
      guestPublicId: {
        type: 'string',
        required: false,
        input: true,
      },
    },
  },
  plugins: [
    admin({
      defaultRole: 'front_desk',
      adminRoles: ['admin'],
    }),
  ],
};

export const auth = betterAuth(authOptions);
