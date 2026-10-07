import { createAuthClient } from 'better-auth/client';

/**
 * Creates the vanilla Better Auth client for browser-based API calls.
 *
 * @returns {ReturnType<typeof createAuthClient>} Configured Better Auth client.
 */
export const authClient = createAuthClient({
  baseURL: process.env.BETTER_AUTH_URL || 'http://localhost:4000',
});
