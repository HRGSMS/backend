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
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
  },
  plugins: [
    admin({
      defaultRole: 'front_desk',
      adminRoles: ['admin'],
    }),
  ],
};

export const auth = betterAuth(authOptions);
