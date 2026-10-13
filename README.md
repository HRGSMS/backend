# backend

The Backend Repository for HRGMS

## Local MySQL connection

Install MySQL locally, create a database, and add a `.env` file in the project root:

```env
DB_HOST=localhost
DB_PORT=3306
# Restricted application account; do not use root for the running backend.
DB_USER=hrgsms_app
DB_PASSWORD=your_runtime_password
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

`db:init` creates the complete schema and database views for a fresh database.
It does not backfill UUIDs, insert seed data, or modify rows in an existing
database. Use `npm run db:recreate` when the database must be rebuilt from
scratch.

The guest-service request status column is part of the initial schema. If an
existing database was created before guest-service requests were added, run
`npm run db:recreate` before using those endpoints; `db:init` intentionally
does not alter existing tables.

The initializer is safe to run more than once because it uses
`CREATE TABLE IF NOT EXISTS`. It creates the tables in foreign-key dependency
order.

### MySQL users and permissions

Use separate MySQL accounts for database setup and application runtime. The
backend should use a restricted runtime account. It needs only:

- `SELECT` for API reads and report views
- `INSERT`, `UPDATE`, and `DELETE` for application writes
- `EXECUTE` for the billing and cancellation procedures

It does not need `CREATE`, `ALTER`, `DROP`, `INDEX`, `REFERENCES`, `TRIGGER`,
`CREATE ROUTINE`, `ALTER ROUTINE`, or `SUPER`.

Create the runtime account as a MySQL administrator:

```sql
CREATE USER 'hrgsms_app'@'localhost'
  IDENTIFIED BY 'strong-runtime-password';

GRANT SELECT, INSERT, UPDATE, DELETE, EXECUTE
  ON hrgsms.* TO 'hrgsms_app'@'localhost';

FLUSH PRIVILEGES;
```

Use this account in `DB_USER` and `DB_PASSWORD` for the running backend.

Database destruction and recreation use the migration account through
`DB_ADMIN_USER` and `DB_ADMIN_PASSWORD`. That account must also have global
permission to drop and create databases; grants only on `hrgsms.*` are not
sufficient because the database is dropped before it is created again.

Run schema creation, database recreation, Better Auth migration, and seeding
with a separate migration/administrator account. Do not grant those
schema-changing permissions to `hrgsms_app`:

```sql
CREATE USER 'hrgsms_migrator'@'localhost'
  IDENTIFIED BY 'strong-migration-password';

GRANT ALL PRIVILEGES
  ON hrgsms.* TO 'hrgsms_migrator'@'localhost';

# Required because this same account runs db:destroy and db:recreate.
GRANT CREATE, DROP ON *.* TO 'hrgsms_migrator'@'localhost';

FLUSH PRIVILEGES;
```

The database tooling sets `DB_USE_ADMIN=true` automatically for schema
creation, database recreation, trigger tests, and Better Auth migrations.
Those commands use `DB_ADMIN_USER` and `DB_ADMIN_PASSWORD`. Hotel data seeding
and authentication account seeding use the normal `DB_USER` and
`DB_PASSWORD` credentials because they only modify rows. Keep
`DB_USER=hrgsms_app` for the running backend.

If binary logging is enabled, MySQL may still reject stored procedure and
trigger definitions for the migration account with a `SUPER` privilege error.
The safest option is to run those schema commands as a controlled DBA/root
deployment step while keeping `log_bin_trust_function_creators` disabled.
For a trusted local development database only, an administrator may instead
enable trusted routine creators:

```sql
SET GLOBAL log_bin_trust_function_creators = 1;
```

`SET GLOBAL` applies immediately but is temporary. `SET PERSIST` survives
restarts:

```sql
SET PERSIST log_bin_trust_function_creators = 1;
```

Verify it with:

```sql
SHOW GLOBAL VARIABLES LIKE 'log_bin_trust_function_creators';
```

This is convenient for local development but less safe than using a
controlled migration account/DBA step. Do not enable it broadly in production
or replicated environments without reviewing the MySQL binary-logging and
replication policy.

Apply Better Auth's authentication tables to the configured MySQL database:

```bash
npm run auth:migrate
```

Create or update the three development staff accounts with Better Auth's
password hashing:

```bash
npm run auth:seed
```

Testing Current implemented triggers

```bash
npm run db:test-triggers
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

### Calculate - Bill

```
POST http://localhost:4000/api/calculate-bill
```

Content-Type: application/json

```
Body(Whule logged in):
{
  "booking_public_id": "UUID_FROM_BOOKINGS_RESPONSE"
}
```

### Cancel booking

Requires a logged-in session. Replace the UUID with an existing
`booking_public_id`.

```http
POST http://localhost:4000/api/cancel-booking
Content-Type: application/json

{
  "booking_public_id": "UUID_FROM_BOOKINGS_RESPONSE"
}
```

Cancels a `Booked` reservation using the configured cancellation policy and
recalculates its bill. The response includes cancellation fees, taxes, and
updated billing values under `data`.

- `400`: Invalid or missing booking UUID.
- `401`: Authentication required.
- `404`: Booking not found.
- `409`: Booking cannot be cancelled or no matching cancellation policy exists.

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

### Guest sign-up

Guests can create their own account and hotel guest profile:

```http
POST /api/auth/guest-sign-up
```

```js
await fetch('http://localhost:4000/api/auth/guest-sign-up', {
  ...authRequestOptions,
  method: 'POST',
  body: JSON.stringify({
    first_name: 'Amina',
    last_name: 'Perera',
    email: 'amina@example.com',
    phone_number: '+94771234567',
    password: 'a-secure-password',
  }),
});
```

The endpoint creates the Better Auth account, creates the corresponding
`guest` row, assigns role `guest`, and links the account to the guest row.
Profile fields remain in the `guest` table; only the link is stored on the
Better Auth user. The frontend should sign in after successful registration
using `POST /api/auth/sign-in/email` with the submitted email and password.
The lower-level Better Auth `POST /api/auth/sign-up/email` endpoint remains
disabled.

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

Supported application roles are `admin`, `manager`, `front_desk`, and `guest`.

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

### Create, update, and delete records

Write APIs require an authenticated session and never accept database primary
key values from the frontend. Every application row has a unique `public_id`
UUID. Use `guest_public_id`, `service_public_id`, `room_public_id`, and
`booking_public_id` instead of numeric database IDs.

All hotel staff roles can manage guests, bookings, payments, and service usage.
Only `admin` and `manager` can manage the service catalogue or cancel a
booking through `DELETE`.

```text
POST   /api/guests
PATCH  /api/guests/:publicId
DELETE /api/guests/:publicId

POST   /api/services
PATCH  /api/services/:publicId
DELETE /api/services/:publicId

POST   /api/bookings
PATCH  /api/bookings/:publicId
DELETE /api/bookings/:publicId
POST   /api/bookings/:publicId/payments
POST   /api/bookings/:publicId/services

GET    /api/service-request-options
GET    /api/service-requests
PATCH  /api/service-requests/:publicId/complete
```

### Real-time staff notifications

The backend provides authenticated Socket.io notifications for connected staff
clients. Connect to the backend URL with the same Better Auth session cookie
used by the HTTP API:

```js
const socket = io('http://localhost:4000', {
  withCredentials: true,
});

socket.on('notification', (notification) => {
  console.log(notification.type, notification.message, notification.data);
});
```

Current notification types are:

- `service_request.created`
- `service_request.completed`
- `service_request.cancelled`
- `guest.created`, `guest.updated`, `guest.deleted`
- `service_catalogue.created`, `service_catalogue.updated`, `service_catalogue.deleted`
- `booking.created`, `booking.updated`, `booking.cancelled`
- `payment.created`
- `booking.bill_recalculated`

### Guest accounts

Guest accounts use Better Auth with role `guest` and must include the
`guestPublicId` user field linking them to a row in `guest`. Guest endpoints
are scoped to that linked profile:

```text
GET    /api/guest/profile
GET    /api/guest/bookings
POST   /api/guest/bookings
POST   /api/guest/bookings/:publicId/cancel
POST   /api/guest/bookings/:publicId/services
DELETE /api/guest/service-requests/:publicId
POST   /api/guest/bookings/:publicId/payments
```

Payments currently record an internal payment; no external payment gateway is
integrated. Guest service requests can be cancelled while they are `Pending`.

An administrator can still create a staff account through Better Auth:

```js
await fetch('http://localhost:4000/api/auth/admin/create-user', {
  ...authRequestOptions,
  method: 'POST',
  body: JSON.stringify({
    name: 'New Employee',
    email: 'amina@example.com',
    password: 'employee-password',
    role: 'manager',
  }),
});
```

Unauthenticated sockets are rejected, and notifications are delivered only to
authenticated `admin`, `manager`, and `front_desk` clients.

Create a guest:

```js
await fetch('http://localhost:4000/api/guests', {
  ...authRequestOptions,
  method: 'POST',
  body: JSON.stringify({
    first_name: 'Amina',
    last_name: 'Perera',
    email: 'amina@example.com',
    phone_number: '+94771234567',
  }),
});
```

Create a booking without exposing room or guest IDs:

```js
const response = await fetch('http://localhost:4000/api/bookings', {
  ...authRequestOptions,
  method: 'POST',
  body: JSON.stringify({
    guest_public_id: 'UUID_FROM_GUESTS_RESPONSE',
    room_public_ids: ['UUID_FROM_ROOMS_RESPONSE'],
    check_in_time: '2026-11-10T14:00:00',
    check_out_time: '2026-11-13T11:00:00',
  }),
});

const { data } = await response.json();
// data.public_id is used for later booking operations.
```

Add a payment or service usage to a booking:

```js
await fetch(`http://localhost:4000/api/bookings/${data.public_id}/payments`, {
  ...authRequestOptions,
  method: 'POST',
  body: JSON.stringify({
    payment_method: 'Card',
    amount: 15000,
  }),
});

await fetch(`http://localhost:4000/api/bookings/${data.public_id}/services`, {
  ...authRequestOptions,
  method: 'POST',
  body: JSON.stringify({
    service_public_id: 'UUID_FROM_SERVICES_RESPONSE',
    room_public_id: 'UUID_FROM_ROOMS_RESPONSE',
    quantity: 1,
  }),
});
```

Booking creation runs in a transaction and checks overlapping active bookings
before assigning rooms. Payment and service writes recalculate the booking
bill using the existing database procedure. Foreign-key and database trigger
errors are returned as explicit `400`, `409`, or `404` responses.

Service requests can only be created for checked-in bookings and rooms assigned
to those bookings. New requests have `status: "Pending"`. Staff can list
requests, filter by `booking_public_id`, `room_public_id`, `service_public_id`,
or `status`, and mark a request complete using its service-request `public_id`.

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

## API tests

Start the backend and ensure the database has been initialized and seeded:

```bash
npm start
```

In another terminal, run the full HTTP API test suite:

```bash
npm run api:test
```

To run all backend test suites, including the database trigger/procedure
tests and the HTTP API suite, use:

```bash
npm test
```

The test runner uses the three seeded development accounts, keeps separate
session cookies for each role, tests admin-only operations, checks all data and
report endpoints, verifies that database IDs are not exposed, and prints
color-coded results with a pass/fail summary. Set `API_URL` to test another
server:

```bash
API_URL=http://localhost:4000 npm run api:test
```

The default `normal` log level prints one concise result for each request. Use
the following options when diagnosing a failed endpoint:

```bash
# Print each request, response status, headers, and response body
npm run api:test -- --verbose

# Print the same request/response trace plus error stack traces
npm run api:test -- --debug

# Print only the final pass/fail summary
npm run api:test -- --quiet
```

The equivalent `API_TEST_LOG_LEVEL` values are `quiet`, `normal`, `verbose`,
and `debug`. Command-line options take precedence over the environment
variable. Request passwords, cookies, authorization values, and token-like
fields are redacted from verbose and debug output. Long response bodies are
truncated to keep logs readable.

check
http://localhost:4000/api/health
