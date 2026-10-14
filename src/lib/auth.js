import { betterAuth } from 'better-auth';
import { admin } from 'better-auth/plugins';
import { pool } from '../config/db.js';

const rawBaseURL = process.env.BETTER_AUTH_URL || `http://localhost:${process.env.PORT || 4000}`;
const baseURL = rawBaseURL.replace(/\/api(\/auth)?\/?$/, '').replace(/\/+$/, '');
const secureCookies =
  process.env.COOKIE_SECURE === 'true' ||
  process.env.NODE_ENV === 'production' ||
  new URL(baseURL).protocol === 'https:';

/**
 * Better Auth server configuration backed by the existing MySQL database.
 *
 * Public sign-up is disabled so only an authenticated admin can create users
 * through the admin plugin's `/admin/create-user` endpoint.
 */
export const authOptions = {
  database: pool,
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL,
  trustedOrigins: [
    baseURL,
    ...(process.env.FRONTEND_URL ? [process.env.FRONTEND_URL.replace(/\/+$/, '')] : []),
    '*',
  ],
  advanced: {
    // Cross-site cookie support for HTTPS/production while preserving local HTTP
    useSecureCookies: secureCookies,
    defaultCookieAttributes: {
      sameSite: secureCookies ? 'none' : 'lax',
      secure: secureCookies,
      httpOnly: true,
    },
  },
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    sendResetPassword: async ({ user, url, token }) => {
      console.log(`\n🔑 ==========================================`);
      console.log(`🔑 [Password Reset] User: ${user.email} (${user.name})`);
      console.log(`🔑 Reset URL: ${url}`);
      console.log(`🔑 Reset Token: ${token}`);
      console.log(`🔑 ==========================================\n`);
    },
  },
  user: {
    additionalFields: {
      guestPublicId: {
        type: 'string',
        required: false,
        input: false,
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
