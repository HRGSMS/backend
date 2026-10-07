# BetterAuth Backend Implementation for HRGMS

## Date: 2026-10-07

---

## Summary

Implemented a complete BetterAuth backend with MySQL database for the HRGMS hotel management system, replacing the previous JWT-based mock authentication with a production-ready authentication solution.

---

## Changes Made

### 1. New Dependencies

```bash
npm install better-auth
```

- `better-auth` - Full-featured authentication library with MySQL adapter

---

### 2. New Files Created

#### `src/config/auth.js`
BetterAuth core configuration with MySQL adapter.

```javascript
import { betterAuth } from 'better-auth';
import { createPool } from 'mysql2/promise';
import 'dotenv/config';

const pool = createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'hrgsms',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

export const auth = betterAuth({
  database: {
    dialect: 'mysql',
    pool,
  },
  baseURL: process.env.AUTH_BASE_URL || 'http://localhost:4000',
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    autoSignIn: true,
  },
  session: {
    cookieCache: {
      enabled: true,
      maxAge: 60 * 60 * 24 * 7, // 7 days
    },
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // 1 day
  },
  user: {
    additionalFields: {
      role: {
        type: 'string',
        required: true,
        defaultValue: 'FrontDesk',
        input: true,
      },
      branchId: {
        type: 'number',
        required: false,
        input: true,
      },
    },
    deleteUser: {
      enabled: true,
    },
  },
  socialProviders: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
    },
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    },
  },
  advanced: {
    crossSubDomainCookies: {
      enabled: false,
    },
    defaultCookieAttributes: {
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
    },
  },
});

export { pool };
```

#### `src/modules/auth/routes.js`
Express routes mounting BetterAuth handlers with custom endpoints.

```javascript
import express from 'express';
import { auth } from '../../config/auth.js';

const router = express.Router();

// Mount BetterAuth handlers
router.all('/sign-in/email', (req, res) => auth.handler(req, res));
router.all('/sign-up/email', (req, res) => auth.handler(req, res));
router.all('/sign-out', (req, res) => auth.handler(req, res));
router.all('/session', (req, res) => auth.handler(req, res));
router.all('/forget-password', (req, res) => auth.handler(req, res));
router.all('/reset-password', (req, res) => auth.handler(req, res));
router.all('/verify-email', (req, res) => auth.handler(req, res));
router.all('/social/*', (req, res) => auth.handler(req, res));

// Custom endpoint to get current user with role
router.get('/me', async (req, res) => {
  try {
    const session = await auth.api.getSession({
      headers: req.headers,
    });

    if (!session) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    res.json({
      user: {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
        role: session.user.role,
        branchId: session.user.branchId,
        image: session.user.image,
        emailVerified: session.user.emailVerified,
        createdAt: session.user.createdAt,
      },
      session: {
        expiresAt: session.session.expiresAt,
        token: session.session.token,
      },
    });
  } catch (error) {
    console.error('Get session error:', error);
    res.status(500).json({ error: 'Failed to get session' });
  }
});

// Custom endpoint for role-based redirect info
router.get('/redirect', async (req, res) => {
  try {
    const session = await auth.api.getSession({
      headers: req.headers,
    });

    if (!session) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const role = session.user.role;
    let redirectPath = '/frontdesk/dashboard';

    switch (role) {
      case 'Manager':
      case 'Admin':
        redirectPath = '/manager/dashboard';
        break;
      case 'FrontDesk':
      default:
        redirectPath = '/frontdesk/dashboard';
        break;
    }

    res.json({
      redirectPath,
      role,
      user: {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
      },
    });
  } catch (error) {
    console.error('Get redirect error:', error);
    res.status(500).json({ error: 'Failed to get redirect' });
  }
});

export default router;
```

#### `db/seed-users.js`
Standalone script to seed demo users with properly hashed passwords.

```javascript
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
```

---

### 3. Modified Files

#### `src/app.js`
Updated to mount auth routes and configure CORS with credentials.

```javascript
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import authRoutes from './modules/auth/routes.js';

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true,
  }));
  app.use(express.json());

  // Health check — confirms the server is up and responding
  app.get('/api/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  // Auth routes
  app.use('/api/auth', authRoutes);

  // TODO: mount other module routers here as each one is built
  // app.use('/api/bookings', bookingRoutes);


  return app;
}
```

#### `db/migrate.js`
Updated with BetterAuth required tables (`user`, `session`, `account`, `verification`) and demo user seed data.

---

## Database Schema

### BetterAuth Tables (Required)

| Table | Purpose |
|-------|---------|
| `user` | User accounts with role and branchId |
| `session` | Active sessions with token and expiration |
| `account` | OAuth accounts and email/password credentials |
| `verification` | Email verification tokens |

### User Table Structure

```sql
CREATE TABLE `user` (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  emailVerified BOOLEAN NOT NULL DEFAULT FALSE,
  image VARCHAR(255),
  role VARCHAR(50) NOT NULL DEFAULT 'FrontDesk',
  branchId INT,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_email (email),
  KEY idx_user_branch (branchId),
  CONSTRAINT fk_user_branch FOREIGN KEY (branchId) REFERENCES Branch (BranchID)
) ENGINE=InnoDB
```

---

## API Endpoints

### BetterAuth Standard Endpoints (mounted at `/api/auth`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/sign-in/email` | Email/password sign in |
| POST | `/sign-up/email` | Email/password sign up |
| POST | `/sign-out` | Sign out |
| GET | `/session` | Get current session |
| POST | `/forget-password` | Request password reset |
| POST | `/reset-password` | Reset password with token |
| POST | `/verify-email` | Verify email with token |
| GET/POST | `/social/*` | OAuth providers |

### Custom Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/auth/me` | Get current user with role/branch |
| GET | `/api/auth/redirect` | Get role-based redirect path |

---

## Frontend Integration

### Frontend Auth Client (`src/lib/auth-client.ts`)

```typescript
import { createAuthClient } from '@better-auth/client';
import type { Auth } from 'better-auth';

const getAuthClient = createAuthClient<Auth>();

export const authClient = getAuthClient({
  baseURL: 'http://localhost:4000',
  fetchOptions: { credentials: 'include' },
});

export const signIn = async (email: string, password: string) => {
  return authClient.signIn.email({ email, password, rememberMe: true });
};

export const signOut = async () => authClient.signOut();
export const getSession = async () => authClient.getSession();
export const useSession = authClient.useSession;
```

### Login Flow

```
1. User visits http://localhost:5173
   ↓
2. Redirects to /login (ProtectedRoute)
   ↓
3. User submits email/password
   ↓
4. POST /api/auth/sign-in/email
   ↓
5. BetterAuth validates credentials
   ↓
6. Sets session cookie (HttpOnly, Secure, SameSite=Lax)
   ↓
7. Returns user data
   ↓
8. Frontend redirects based on role:
   - FrontDesk → /frontdesk/dashboard
   - Manager/Admin → /manager/dashboard
```

---

## Demo Users

Run the seed script after migration:

```bash
node db/seed-users.js
```

| Role | Email | Password |
|------|-------|----------|
| FrontDesk | frontdesk@hotel.com | password123 |
| Manager | manager@hotel.com | password123 |
| Admin | admin@hotel.com | password123 |

---

## Environment Variables

Add to `.env`:

```env
# Database
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=yourpassword
DB_NAME=hrgsms

# Auth
AUTH_BASE_URL=http://localhost:4000
FRONTEND_URL=http://localhost:5173

# Social Providers (optional)
GITHUB_CLIENT_ID=xxx
GITHUB_CLIENT_SECRET=xxx
GOOGLE_CLIENT_ID=xxx
GOOGLE_CLIENT_SECRET=xxx

# Server
PORT=4000
```

---

## Running the Backend

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Database

Ensure MySQL is running and update `.env` with correct credentials.

### 3. Run Migration

```bash
npm run migrate
```

This creates all tables and seeds demo data.

### 4. Seed Users (if needed)

```bash
node db/seed-users.js
```

### 5. Start Server

```bash
npm run dev
```

Server runs on `http://localhost:4000`

---

## Testing

### Health Check

```bash
curl http://localhost:4000/api/health
# {"status":"ok"}
```

### Sign In

```bash
curl -X POST http://localhost:4000/api/auth/sign-in/email \
  -H "Content-Type: application/json" \
  -d '{"email":"frontdesk@hotel.com","password":"password123"}' \
  -c cookies.txt
```

### Get Session

```bash
curl http://localhost:4000/api/auth/me -b cookies.txt
```

### Get Redirect Path

```bash
curl http://localhost:4000/api/auth/redirect -b cookies.txt
# {"redirectPath":"/frontdesk/dashboard","role":"FrontDesk",...}
```

### Sign Out

```bash
curl -X POST http://localhost:4000/api/auth/sign-out -b cookies.txt
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Express App                               │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  /api/auth                                                │   │
│  │  ┌────────────────────────────────────────────────────┐  │   │
│  │  │           BetterAuth Handler                        │  │   │
│  │  │  ┌────────────┐ ┌────────────┐ ┌────────────────┐  │  │   │
│  │  │  │ Sign In    │ │ Sign Up    │ │ Session Mgmt   │  │  │   │
│  │  │  │ Email      │ │ Email      │ │ (cookies)      │  │  │   │
│  │  │  └────────────┘ └────────────┘ └────────────────┘  │  │   │
│  │  │  ┌────────────┐ ┌────────────┐ ┌────────────────┐  │  │   │
│  │  │  │ Password   │ │ Email      │ │ Social (GitHub,│  │  │   │
│  │  │  │ Reset      │ │ Verify     │ │  Google)       │  │  │   │
│  │  │  └────────────┘ └────────────┘ └────────────────┘  │  │   │
│  │  └────────────────────────────────────────────────────┘  │   │
│  │  ┌────────────────────────────────────────────────────┐  │   │
│  │  │           Custom Endpoints                          │  │   │
│  │  │  GET /me       → Full user + session                │  │   │
│  │  │  GET /redirect → Role-based redirect path           │  │   │
│  │  └────────────────────────────────────────────────────┘  │   │
│  └──────────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  MySQL Pool (mysql2)                                       │   │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌──────────────┐   │   │
│  │  │ user    │ │ session │ │ account │ │ verification │   │   │
│  │  └─────────┘ └─────────┘ └─────────┘ └──────────────┘   │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Security Features

1. **HttpOnly Cookies** - Session tokens not accessible via JavaScript
2. **Secure Cookies** - HTTPS only in production
3. **SameSite=Lax** - CSRF protection
4. **Bcrypt Password Hashing** - Automatic with BetterAuth
5. **Session Expiration** - 7 days with sliding window
6. **Role-Based Access** - Built-in role field with FrontDesk/Manager/Admin
7. **Branch Isolation** - Users tied to branchId for multi-property support

---

## Next Steps

### 1. Email Verification (Production)

```javascript
// In auth.js
emailAndPassword: {
  enabled: true,
  requireEmailVerification: true,
  sendVerificationEmail: async ({ user, url }) => {
    // Integrate with SendGrid, Resend, Nodemailer, etc.
    await emailService.send({
      to: user.email,
      subject: 'Verify your email',
      html: `<a href="${url}">Verify</a>`,
    });
  },
}
```

### 2. Social Login

Configure in `.env`:
```env
GITHUB_CLIENT_ID=your_github_client_id
GITHUB_CLIENT_SECRET=your_github_client_secret
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
```

Frontend will automatically show social login buttons.

### 3. Password Reset Flow

BetterAuth handles the token generation. Implement email sending:

```javascript
// In auth.js - add to emailAndPassword
sendResetPasswordEmail: async ({ user, url }) => {
  await emailService.send({
    to: user.email,
    subject: 'Reset your password',
    html: `<a href="${url}">Reset Password</a>`,
  });
}
```

### 4. Protected API Middleware

Create a middleware for other routes:

```javascript
// src/middleware/auth.js
import { auth } from '../config/auth.js';

export async function requireAuth(req, res, next) {
  const session = await auth.api.getSession({ headers: req.headers });
  
  if (!session) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  
  req.user = session.user;
  req.session = session.session;
  next();
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}
```

Usage:
```javascript
import { requireAuth, requireRole } from './middleware/auth.js';

app.get('/api/admin/users', requireAuth, requireRole('Admin'), handler);
app.get('/api/manager/reports', requireAuth, requireRole('Manager', 'Admin'), handler);
```

### 5. Rate Limiting for Auth

```javascript
import rateLimit from 'express-rate-limit';

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts per window
  message: { error: 'Too many attempts, please try again later' },
});

app.use('/api/auth/sign-in', authLimiter);
app.use('/api/auth/sign-up', authLimiter);
```

---

## Troubleshooting

### MySQL Connection Issues

1. Ensure MySQL is running: `sudo systemctl status mysql`
2. Check credentials in `.env`
3. For root access issues: `mysql -u root -p` and run:
   ```sql
   ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY 'yourpassword';
   FLUSH PRIVILEGES;
   ```

### BetterAuth Errors

- Check server logs for detailed error messages
- Ensure database tables exist (run migration)
- Verify CORS settings match frontend URL

### Session Issues

- Clear browser cookies for localhost
- Check `credentials: 'include'` in frontend fetch
- Verify `FRONTEND_URL` matches exactly (including port)

---

## Files Summary

| File | Status | Description |
|------|--------|-------------|
| `src/config/auth.js` | ✅ Created | BetterAuth configuration |
| `src/modules/auth/routes.js` | ✅ Created | Auth routes with custom endpoints |
| `src/app.js` | ✅ Updated | Mount auth routes, CORS config |
| `db/migrate.js` | ✅ Updated | BetterAuth tables + user seed |
| `db/seed-users.js` | ✅ Created | Standalone user seeding script |
| `package.json` | ✅ Updated | Added better-auth dependency |
| `.env` | ⚠️ Needs Update | Database credentials |

---

## Git Branch

```bash
git checkout -b login_page
git add .
git commit -m "feat: BetterAuth backend implementation with MySQL"
git push origin login_page
```

---

*Generated on 2026-10-07*