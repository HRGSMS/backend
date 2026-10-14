import { betterAuth } from 'better-auth';
import { pool } from '../src/config/db.js';
import { authOptions } from '../src/lib/auth.js';
import { ensureGuestAuthLink } from './migrate-guest-auth.js';

const staffAccounts = [
  ['Admin', 'admin@hotel.com', 'admin123', 'admin'],
  ['Manager', 'manager@hotel.com', 'manager123', 'manager'],
  ['Front Desk', 'frontdesk@hotel.com', 'frontdesk123', 'front_desk'],
];

const fallbackGuests = [
  ['Amara', 'Perera', 'amara.perera@example.com', 'guest123'],
  ['Nimal', 'Fernando', 'nimal.fernando@example.com', 'guest123'],
  ['Kavya', 'Silva', 'kavya.silva@example.com', 'guest123'],
  ['Dilan', 'Jayawardena', 'dilan.j@example.com', 'guest123'],
  ['Maya', 'Wijesinghe', 'maya.w@example.com', 'guest123'],
  ['Oliver', 'Thompson', 'oliver.thompson@example.com', 'guest123'],
  ['Sophie', 'Chen', 'sophie.chen@example.com', 'guest123'],
];

/**
 * Creates the initial staff and guest accounts using Better Auth's password hashing.
 *
 * Public sign-up remains disabled in the application configuration. This
 * bootstrap-only script enables sign-up in a separate Better Auth instance,
 * then assigns the requested roles and links guest profiles directly in Better Auth's user table.
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

  const connection = await pool.getConnection();

  try {
    await ensureGuestAuthLink(connection);

    // 1. Seed staff accounts
    console.log('Seeding staff accounts...');
    for (const [name, email, password, role] of staffAccounts) {
      const [existingUser] = await connection.execute('SELECT id FROM `user` WHERE email = ?', [
        email,
      ]);

      if (existingUser.length > 0) {
        await connection.execute('UPDATE `user` SET role = ? WHERE email = ?', [role, email]);
        console.log(`Updated existing staff account: ${email} (${role})`);
        continue;
      }

      await bootstrapAuth.api.signUpEmail({
        body: {
          name,
          email,
          password,
        },
      });

      await connection.execute('UPDATE `user` SET role = ? WHERE email = ?', [role, email]);
      console.log(`Created staff account: ${email} (${role})`);
    }

    // 2. Seed guest accounts linked to guest profiles
    console.log('Seeding guest accounts...');
    const [dbGuests] = await connection.execute(
      'SELECT public_id, first_name, last_name, email FROM guest ORDER BY guest_id',
    );

    const guestList =
      dbGuests.length > 0
        ? dbGuests.map((g) => ({
            name: `${g.first_name} ${g.last_name}`,
            email: g.email,
            password: 'guest123',
            publicId: g.public_id,
          }))
        : fallbackGuests.map(([first, last, email, password]) => ({
            name: `${first} ${last}`,
            email,
            password,
            publicId: null,
          }));

    for (const guest of guestList) {
      const [existingUser] = await connection.execute('SELECT id FROM `user` WHERE email = ?', [
        guest.email,
      ]);

      if (existingUser.length > 0) {
        await connection.execute(
          'UPDATE `user` SET role = ?, guestPublicId = COALESCE(?, guestPublicId) WHERE email = ?',
          ['guest', guest.publicId, guest.email],
        );
        console.log(
          `Updated existing guest account: ${guest.email} (role: guest, guestPublicId: ${guest.publicId})`,
        );
        continue;
      }

      await bootstrapAuth.api.signUpEmail({
        body: {
          name: guest.name,
          email: guest.email,
          password: guest.password,
        },
      });

      await connection.execute('UPDATE `user` SET role = ?, guestPublicId = ? WHERE email = ?', [
        'guest',
        guest.publicId,
        guest.email,
      ]);
      console.log(
        `Created guest account: ${guest.email} (role: guest, guestPublicId: ${guest.publicId})`,
      );
    }
  } finally {
    connection.release();
    await pool.end();
  }
}

seedAuthAccounts().catch((error) => {
  console.error('Authentication account seeding failed:', error.message);
  process.exitCode = 1;
});
