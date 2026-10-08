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
FRONTEND_URL=http://localhost:5173
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

## Authentication API

The frontend should use the backend base URL:

```text
http://localhost:4000/api/auth
```

Better Auth stores the session in an HTTP cookie. Always send credentials from
the frontend so the cookie is stored and sent with subsequent requests:

```js
const authRequestOptions = {
  credentials: 'include',
  headers: {
    'Content-Type': 'application/json',
  },
};
```

### Sign in

```http
POST /api/auth/sign-in/email
```

```js
const response = await fetch('http://localhost:4000/api/auth/sign-in/email', {
  ...authRequestOptions,
  method: 'POST',
  body: JSON.stringify({
    email: 'admin@hotel.com',
    password: 'admin123',
    rememberMe: true,
  }),
});

const result = await response.json();
```

The response contains the authenticated user and session information. Store
the cookie through the browser; do not store the password or session token in
local storage.

### Get the current session

```http
GET /api/auth/get-session
```

```js
const response = await fetch('http://localhost:4000/api/auth/get-session', {
  credentials: 'include',
});

const session = await response.json();
```

Use this endpoint when the frontend loads to determine whether the user is
authenticated. A missing or expired session returns an unauthenticated
response.

### Sign out

```http
POST /api/auth/sign-out
```

```js
await fetch('http://localhost:4000/api/auth/sign-out', {
  ...authRequestOptions,
  method: 'POST',
});
```

### Public sign-up

Public sign-up is intentionally disabled because only admins may create
accounts. The following endpoint must not be used by the frontend:

```http
POST /api/auth/sign-up/email
```

It returns an error with public registration disabled. New accounts must be
created by an authenticated admin through the admin endpoint below.

### Admin: create a user

Only a user with the `admin` role may call this endpoint:

```http
POST /api/auth/admin/create-user
```

```js
const response = await fetch('http://localhost:4000/api/auth/admin/create-user', {
  ...authRequestOptions,
  method: 'POST',
  body: JSON.stringify({
    name: 'New Employee',
    email: 'employee@hotel.com',
    password: 'a-secure-password',
    role: 'manager',
  }),
});

const createdUser = await response.json();
```

Supported application roles are `admin`, `manager`, and `front_desk`.

### Admin: change a user's role

Only an admin may change roles:

```http
POST /api/auth/admin/set-role
```

```js
await fetch('http://localhost:4000/api/auth/admin/set-role', {
  ...authRequestOptions,
  method: 'POST',
  body: JSON.stringify({
    userId: 'USER_ID_FROM_CREATE_USER_OR_LIST_USERS',
    role: 'front_desk',
  }),
});
```

### Admin: list users

Only an admin may list accounts:

```http
GET /api/auth/admin/list-users
```

```js
const response = await fetch('http://localhost:4000/api/auth/admin/list-users?limit=100', {
  credentials: 'include',
});

const users = await response.json();
```

Admin requests made without a valid admin session return an authorization
error. Managers and front-desk users can sign in and access their session, but
cannot create users, change roles, or list users.

## Data APIs

All data APIs require an authenticated Better Auth session cookie. Frontend
requests must use `credentials: 'include'`:

```js
const response = await fetch('http://localhost:4000/api/rooms', {
  credentials: 'include',
});
const result = await response.json();
```

The backend returns successful collection responses in the form
`{ "data": [...] }`. Unauthenticated requests receive HTTP `401`.

### Reference data

```text
GET /api/branches
GET /api/room-types
GET /api/amenities
GET /api/services
GET /api/guests
```

Collection endpoints support pagination:

```text
GET /api/guests?limit=20&offset=0
```

`limit` is capped at 100.

### Rooms

```text
GET /api/rooms
GET /api/rooms?available_from=2026-10-20&available_to=2026-10-23
```

The availability query excludes rooms with an overlapping `Booked` or
`Checked-In` booking. Dates are interpreted as an exclusive end interval.

### Bookings

```text
GET /api/bookings
GET /api/bookings?status=Checked-In
```

Database primary-key IDs are intentionally not returned by these APIs and
cannot be used as query parameters. Use human-readable values such as
booking status, guest email, branch name, room number, and date ranges.

### Reports

The report endpoints query database views created by `npm run db:init`:

- `report_occupancy`
- `report_guest_billing`
- `report_service_usage`
- `report_revenue`
- `report_top_services`

The views keep report joins and calculations in the database while allowing
the API to apply request-specific date filters.

Room occupancy for a date interval:

```text
GET /api/reports/occupancy?from=2026-10-01&to=2026-10-31
```

Guest billing and outstanding balances:

```text
GET /api/reports/billing
```

Service usage grouped by room and service:

```text
GET /api/reports/service-usage
GET /api/reports/service-usage?from=2026-10-01&to=2026-11-01
```

Revenue by branch for a date interval:

```text
GET /api/reports/revenue?from=2026-10-01&to=2026-11-01
```

Top-used services and their revenue:

```text
GET /api/reports/top-services
```

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
