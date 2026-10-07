import { betterAuth } from 'better-auth';
import { pool } from '../src/config/db.js';
import { authOptions } from '../src/lib/auth.js';

const accounts = [
  ['Admin', 'admin@hotel.com', 'admin123', 'admin'],
  ['Manager', 'manager@hotel.com', 'manager123', 'manager'],
  ['Front Desk', 'frontdesk@hotel.com', 'frontdesk123', 'front_desk'],
];

/**
 * Creates the initial staff accounts using Better Auth's password hashing.
 *
 * Public sign-up remains disabled in the application configuration. This
 * bootstrap-only script enables sign-up in a separate Better Auth instance,
 * then assigns the requested roles directly in Better Auth's user table.
 *
 * @returns {Promise<void>} Resolves after all initial accounts are created.
 */
async function seedAuthAccounts() {
  const bootstrapAuth = betterAuth({
    ...authOptions,
    emailAndPassword: {
      ...authOptions.emailAndPassword,
      disableSignUp: false,
    },
  });

  try {
    for (const [name, email, password, role] of accounts) {
      const existingUser = await pool.query('SELECT id FROM `user` WHERE email = ?', [email]);

      if (existingUser[0].length > 0) {
        await pool.execute('UPDATE `user` SET role = ? WHERE email = ?', [role, email]);
        console.log(`Updated existing account: ${email}`);
        continue;
      }

      await bootstrapAuth.api.signUpEmail({
        body: {
          name,
          email,
          password,
        },
      });

      await pool.execute('UPDATE `user` SET role = ? WHERE email = ?', [role, email]);
      console.log(`Created account: ${email}`);
    }
  } finally {
    await pool.end();
  }
}

seedAuthAccounts().catch((error) => {
  console.error('Authentication account seeding failed:', error.message);
  process.exitCode = 1;
});
