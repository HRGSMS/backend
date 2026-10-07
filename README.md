# backend

The Backend Repository for HRGMS

## Local MySQL connection

Install MySQL locally, create a database, and add a `.env` file in the project root:

```env
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_mysql_password
DB_NAME=hrgsms
PORT=4000
BETTER_AUTH_URL=http://localhost:4000
BETTER_AUTH_SECRET=your_generated_32_character_or_longer_secret
```

The server checks the MySQL connection before listening:

```bash
npm install
npm start
```

Initialize the database tables after creating the database configured in `.env`:

```bash
npm run db:init
```

The initializer is safe to run more than once because it uses
`CREATE TABLE IF NOT EXISTS`. It creates the tables in foreign-key dependency
order.

Apply Better Auth's authentication tables to the configured MySQL database:

```bash
npm run auth:migrate
```

Create or update the three development staff accounts with Better Auth's
password hashing:

```bash
npm run auth:seed
```

Authentication endpoints are available under `/api/auth`. The configured
Better Auth admin plugin disables public sign-up and allows only users with
the `admin` role to create users or change roles.

The initial accounts are:

| Role       | Email                 | Password       |
| ---------- | --------------------- | -------------- |
| Admin      | `admin@hotel.com`     | `admin123`     |
| Manager    | `manager@hotel.com`   | `manager123`   |
| Front Desk | `frontdesk@hotel.com` | `frontdesk123` |

These accounts must be created through an administrator bootstrap step before
they can sign in. Do not use these development passwords in production.

Seed the initialized database with representative SkyNest Hotels data:

```bash
npm run db:seed
```

The seed script runs in a transaction and replaces the existing rows in these
tables with deterministic sample data. It creates 3 branches, 12 rooms, 6
services, 5 guests, 8 bookings, service usage records, and 5 payments
including partial payments.

Destroy the configured database, including all its tables and data:

```bash
npm run db:destroy
```

Destroy and rebuild the configured database, including the schema and seed
data:

```bash
npm run db:recreate
```

Both commands use the database configured by `DB_NAME` and reject names that
contain characters outside letters, numbers, and underscores.

check
http://localhost:4000/api/health
