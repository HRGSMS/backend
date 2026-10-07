import bcrypt from 'bcrypt';
import mysql from 'mysql2/promise';
import 'dotenv/config';

async function seedUsers() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'hrgsms',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  });

  try {
    // Hash passwords
    const password = 'password123';
    const hashedPassword = await bcrypt.hash(password, 10);

    console.log('Generated password hash for:', password);
    console.log('Hash:', hashedPassword);

    // Verify the hash works
    const isValid = await bcrypt.compare(password, hashedPassword);
    console.log('Hash verification:', isValid);

    // Insert users
    const users = [
      {
        id: 'usr_frontdesk_001',
        name: 'Front Desk User',
        email: 'frontdesk@hotel.com',
        role: 'FrontDesk',
        branchId: 1,
      },
      {
        id: 'usr_manager_001',
        name: 'Hotel Manager',
        email: 'manager@hotel.com',
        role: 'Manager',
        branchId: 1,
      },
      {
        id: 'usr_admin_001',
        name: 'System Admin',
        email: 'admin@hotel.com',
        role: 'Admin',
        branchId: null,
      },
    ];

    for (const user of users) {
      const [result] = await pool.query(
        `INSERT INTO \`user\` (id, name, email, emailVerified, role, branchId, createdAt, updatedAt)
         VALUES (?, ?, ?, TRUE, ?, ?, NOW(), NOW())
         ON DUPLICATE KEY UPDATE
           name = VALUES(name),
           emailVerified = VALUES(emailVerified),
           role = VALUES(role),
           branchId = VALUES(branchId),
           updatedAt = NOW()`,
        [user.id, user.name, user.email, user.role, user.branchId]
      );
      console.log(`User ${user.email} inserted/updated`);
    }

    // Insert accounts with hashed passwords
    for (const user of users) {
      const accountId = `acc_${user.id.split('_')[1]}_${user.id.split('_')[2]}`;
      await pool.query(
        `INSERT INTO \`account\` (id, accountId, providerId, userId, password, createdAt, updatedAt)
         VALUES (?, ?, 'email', ?, ?, NOW(), NOW())
         ON DUPLICATE KEY UPDATE
           password = VALUES(password),
           updatedAt = NOW()`,
        [accountId, user.email, user.id, hashedPassword]
      );
      console.log(`Account for ${user.email} inserted/updated with hashed password`);
    }

    console.log('\n✅ Demo users created successfully!');
    console.log('\nLogin credentials:');
    console.log('  Front Desk: frontdesk@hotel.com / password123');
    console.log('  Manager:    manager@hotel.com / password123');
    console.log('  Admin:      admin@hotel.com / password123');

  } catch (error) {
    console.error('Seeding failed:', error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

seedUsers();