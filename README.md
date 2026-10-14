# SkyNest Hotels HRGSMS — Backend

The backend REST API and database engine for the **Hotel Reservation and Guest Services Management System (HRGSMS)** of SkyNest Hotels (operating in Colombo, Kandy, and Galle, Sri Lanka).

Built with **Node.js**, **Express**, **MySQL 8.0**, **Better Auth**, and **Socket.io**.

---

## Table of Contents

1. [Features & Tech Stack](#features--tech-stack)
2. [Prerequisites](#prerequisites)
3. [Environment Configuration](#environment-configuration)
4. [Database Setup & Management](#database-setup--management)
   - [MySQL Users & Permissions](#mysql-users--permissions)
   - [Step 1: Initialize Database Schema](#step-1-initialize-database-schema)
   - [Step 2: Migrate Authentication Tables](#step-2-migrate-authentication-tables)
   - [Step 3: Seed Hotel Data](#step-3-seed-hotel-data)
   - [Step 4: Seed User Credentials](#step-4-seed-user-credentials)
   - [Database Teardown & Quick Rebuild](#database-teardown--quick-rebuild)
5. [Database Automation & ACID Rules](#database-automation--acid-rules)
   - [Triggers & Integrity Rules](#triggers--integrity-rules)
   - [Stored Procedures](#stored-procedures)
   - [Testing Triggers & Procedures](#testing-triggers--procedures)
6. [Running the Application](#running-the-application)
   - [Health Check](#health-check)
7. [API Reference](#api-reference)
   - [API Conventions & Security](#api-conventions--security)
   - [Authentication & User Management (`/api/auth`)](#authentication--user-management-apiauth)
   - [Public Room Catalog & Availability (`/api/rooms`)](#public-room-catalog--availability-apirooms)
   - [Reference Data APIs](#reference-data-apis)
   - [Hotel Operations & Bookings (`/api/bookings`)](#hotel-operations--bookings-apibookings)
   - [Billing & Payments](#billing--payments)
   - [Cancellation Management](#cancellation-management)
   - [Service Catalogue & Requests](#service-catalogue--requests)
   - [Guest Self-Service Portal (`/api/guest`)](#guest-self-service-portal-apiguest)
   - [Management & Analytical Reports (`/api/reports`)](#management--analytical-reports-apireports)
   - [Hotel Management Settings (`/api/management/settings`)](#hotel-management-settings-apimanagementsettings)
8. [Real-Time Staff Notifications (WebSockets)](#real-time-staff-notifications-websockets)
9. [Testing & Quality Assurance](#testing--quality-assurance)

---

## Features & Tech Stack

- **Relational Consistency**: 3NF/BCNF design with strict foreign keys, composite constraints, and immutable historical price snapshots.
- **ACID Database Automation**: MySQL stored procedures (`sp_calculate_bill`, `sp_cancel_booking`) and triggers ensuring automated room status synchronization, double-booking prevention, single-branch reservation enforcement, and checkout dues verification.
- **Session-Based Authentication**: Built with Better Auth supporting role-based access control (`admin`, `manager`, `front_desk`, and `guest`) via secure HTTP-only cookies.
- **Analytical Reporting**: Pre-aggregated database views for room occupancy, guest billing summaries, service breakdown, monthly branch revenues, and top services.
- **Real-Time Staff Dispatch**: Socket.io event emitter broadcasting room updates, service requests, and payment transactions to connected staff clients.

---

## Prerequisites

- **Node.js**: `v18.x` or higher
- **MySQL Server**: `v8.0` or higher
- **npm**: `v9.x` or higher

---

## Environment Configuration

Create a `.env` file in the `backend/` directory:

```env
# Application Runtime Server
PORT=4000
FRONTEND_URL=http://localhost:5173

# Database Connection (Restricted Runtime Account)
DB_HOST=localhost
DB_PORT=3306
DB_NAME=hrgsms
DB_USER=hrgsms_app
DB_PASSWORD=your_runtime_password

# Database Migration & Teardown Account (Optional / Admin)
DB_ADMIN_USER=hrgsms_migrator
DB_ADMIN_PASSWORD=your_migration_password

# Better Auth Configuration
BETTER_AUTH_URL=http://localhost:4000
BETTER_AUTH_SECRET=your_generated_32_character_or_longer_secret
```

---

## Database Setup & Management

### MySQL Users & Permissions

Following security best practices, separation of privileges is maintained between the application runtime and database administration/migrations.

#### 1. Runtime Account (`hrgsms_app`)
The running backend requires only data manipulation and procedure execution permissions. It does **not** need schema modification privileges:

```sql
CREATE USER 'hrgsms_app'@'localhost' IDENTIFIED BY 'your_runtime_password';

GRANT SELECT, INSERT, UPDATE, DELETE, EXECUTE
  ON hrgsms.* TO 'hrgsms_app'@'localhost';

FLUSH PRIVILEGES;
```

#### 2. Migration & Administration Account (`hrgsms_migrator`)
Used for database initialization, schema changes, database recreation, and trigger definitions:

```sql
CREATE USER 'hrgsms_migrator'@'localhost' IDENTIFIED BY 'your_migration_password';

GRANT ALL PRIVILEGES ON hrgsms.* TO 'hrgsms_migrator'@'localhost';

-- Required for db:destroy and db:recreate (dropping and recreating the database):
GRANT CREATE, DROP ON *.* TO 'hrgsms_migrator'@'localhost';

FLUSH PRIVILEGES;
```

> **Note on Binary Logging**: If MySQL binary logging is enabled, creating stored routines or triggers may require `SUPER` privileges or the `log_bin_trust_function_creators` variable set:
> ```sql
> SET PERSIST log_bin_trust_function_creators = 1;
> ```

---

### Step 1: Initialize Database Schema

Create the database tables, views, stored procedures, and triggers:

```bash
npm run db:init
```

`db:init` runs in dependency order using `CREATE TABLE IF NOT EXISTS` and installs all triggers and stored procedures via `db/triggers.js`.

---

### Step 2: Migrate Authentication Tables

Run Better Auth migrations to generate auth tables and add the guest profile linkage:

```bash
npm run auth:migrate
```

---

### Step 3: Seed Hotel Data

You can choose between the **Standard Rubric Seed** or the **Comprehensive Edge-Case Seed**.

#### Option A: Standard Rubric Dataset (Minimal)
Populates the baseline assignment dataset (3 branches, 12 rooms, 6 services, 5 guests, 8 bookings, and payments):

```bash
npm run db:seed
```

#### Option B: Comprehensive Edge-Case Dataset (Recommended for Full Testing)
Populates an extensive operational dataset (3 branches, 25 rooms, 8 services, 14 guests, 20 bookings) modeling all hotel operational edge cases:

```bash
npm run db:seed:comprehensive
```

**Edge cases modeled in the comprehensive dataset:**
- **Multi-room reservations**: Bookings spanning multiple rooms with per-room service usage.
- **Single-branch enforcement**: Validating all multi-room bookings stay strictly within the same property.
- **Same-day room turnover**: Checkout at 11:00 AM and next guest check-in at 14:00 PM for the same room.
- **Full lifecycle coverage**: `Booked`, `Checked-In`, `Checked-Out`, and `Cancelled`.
- **Payment & billing diversity**: `Paid`, `Partially Paid` (deposits), `Unpaid`, and `Credit Due` (overpayment/refund balances).
- **Payment methods**: Cash, Card, Bank Transfer, and split-payment transactions.
- **Service request lifecycle**: Zero-service stays, VIP high-volume consumption (5+ services), and `Pending` vs `Completed` requests.
- **Cancellation policy tiers**: >72h free cancellation, 24-71h first-night penalty, and <24h late penalty with services charged.
- **Guest diversity**: Domestic travelers, international tourists, corporate accounts, and newly registered guests with 0 bookings.

---

### Step 4: Seed User Credentials

Provisions development credentials for staff and all seeded guests:

```bash
npm run auth:seed
```

#### Default Seeded Credentials

| Role | Email | Password |
| :--- | :--- | :--- |
| **Admin** | `admin@hotel.com` | `admin123` |
| **Manager** | `manager@hotel.com` | `manager123` |
| **Front Desk** | `frontdesk@hotel.com` | `frontdesk123` |
| **Guests** | Any seeded guest email (e.g. `amara.perera@example.com`) | `guest123` |

---

### Database Teardown & Quick Rebuild

To completely drop the database:

```bash
npm run db:destroy
```

To wipe and rebuild everything in a single command (drop, recreate, init, migrate auth, seed data, and seed users):

```bash
# Rebuild with Standard Seed:
npm run db:recreate

# Rebuild with Comprehensive Seed (Recommended):
npm run db:recreate:comprehensive
```

---

## Database Automation & ACID Rules

All business rules are enforced directly inside MySQL to preserve ACID guarantees regardless of which application client touches the database.

### Triggers & Integrity Rules

| Trigger | Table | Event | Rule Enforced |
| :--- | :--- | :--- | :--- |
| `booking_validate` | `booking` | `BEFORE INSERT, UPDATE` | Validates dates (`check_out > check_in`), allowed status values, and tax rate bounds [0, 1]. |
| `booking_checkout_dues` | `booking` | `BEFORE UPDATE` | Blocks `booking_status = 'Checked-Out'` if `outstanding_amount > 0`. |
| `booking_branch_tax_validate` | `booking` | `BEFORE UPDATE` | Prevents changing a booking's `tax_id` to a branch that does not match the rooms already booked. |
| `booking_room_price` | `booking_room` | `BEFORE INSERT, UPDATE` | **1. Single-Branch Enforcement**: Blocks adding rooms from different branches to the same booking.<br>**2. Tax Consistency**: Ensures room branch matches the booking's `tax_id` branch.<br>**3. Double-Booking Prevention**: Rejects overlapping bookings for the same room.<br>**4. Snapshot Pricing**: Auto-populates `nightly_rate_at_booking` and total room stay price. |
| `booking_room_status_after_*` | `booking`, `booking_room` | `AFTER INSERT, UPDATE` | Automatically synchronizes `room.current_status` (Occupied = 1) on `Checked-In`, and resets to Available (0) on `Checked-Out` or `Cancelled`. |
| `service_usage_validate` | `service_usage` | `BEFORE INSERT, UPDATE` | Enforces positive quantity, snapshots service price and tax rate, and verifies the room belongs to the booking. |
| `payment_validate` | `payment` | `BEFORE INSERT, UPDATE` | Enforces positive payment amount. |
| `room_type_price`, `service_catalogue_price` | `room_type`, `service_catalogue` | `BEFORE INSERT, UPDATE` | Audits price updates and automatically updates `rate_update_time` and `price_update_time`. |

### Stored Procedures

- **`CALL sp_calculate_bill(p_booking_id INT)`**:
  Calculates room charges (`nightly_rate * nights`), service charges (`quantity * price`), and applicable taxes. Updates `total_charge`, `total_tax_amount`, `outstanding_amount`, `credit_amount`, and sets `payment_status` (`Paid`, `Partially Paid`, `Credit Due`, or `Unpaid`).
- **`CALL sp_cancel_booking(p_booking_id INT)`**:
  Applies the tiered cancellation policy based on notice period hours (`TIMESTAMPDIFF`), computes cancellation fees and taxes, updates booking status to `Cancelled`, and recalculates final bill balances.

### Testing Triggers & Procedures

Run the automated trigger test suite to verify all database constraints and procedures:

```bash
npm run db:test-triggers
```

---

## Running the Application

### Development Mode (with Nodemon)
```bash
npm run dev
```

### Production Mode
```bash
npm start
```

### Health Check
Verify the server is up and responding:

```http
GET http://localhost:4000/api/health
```

**Response:**
```json
{
  "status": "ok"
}
```

---

## API Reference

### API Conventions & Security

- **UUID Public Identifiers**: Database auto-increment primary keys are never exposed in API responses or accepted in request bodies. All resources use opaque `public_id` UUIDs.
- **Session Cookies**: All protected routes require an active Better Auth session. When calling from frontends, always set credentials:
  ```js
  fetch('/api/...', { credentials: 'include' });
  ```
- **Standard Response Shape**: Successful collection responses are wrapped in `{ "data": [...] }`.

---

### Authentication & User Management (`/api/auth`)

#### 1. Sign In
```http
POST /api/auth/sign-in/email
Content-Type: application/json

{
  "email": "admin@hotel.com",
  "password": "admin123",
  "rememberMe": true
}
```

#### 2. Get Current Session
```http
GET /api/auth/get-session
```
Returns authenticated user details and active role.

#### 3. Sign Out
```http
POST /api/auth/sign-out
```

#### 4. Guest Self-Registration
Guests can register their own account and hotel guest profile:
```http
POST /api/auth/guest-sign-up
Content-Type: application/json

{
  "first_name": "Amina",
  "last_name": "Perera",
  "email": "amina@example.com",
  "phone_number": "+94771234567",
  "password": "a-secure-password"
}
```

#### 5. Update Password (Self-Service)
Any logged-in staff member or guest can update their own password:
```http
POST /api/auth/change-password
Content-Type: application/json

{
  "currentPassword": "current_password",
  "newPassword": "new_secure_password",
  "revokeOtherSessions": true
}
```
*Note:* Requires an active session cookie (`credentials: 'include'`). The new password must be at least 8 characters. Setting `revokeOtherSessions: true` revokes all other active sessions for that account.

#### 6. Staff Administration (Admin Only)
- **Create Staff User**: `POST /api/auth/admin/create-user` (Roles: `admin`, `manager`, `front_desk`)
- **Change User Role**: `POST /api/auth/admin/set-role`
- **Reset User Password**: `POST /api/auth/admin/set-user-password`
  ```http
  POST /api/auth/admin/set-user-password
  Content-Type: application/json

  {
    "userId": "USER_ID_FROM_LIST_USERS",
    "newPassword": "new_temporary_password"
  }
  ```
- **List All Users**: `GET /api/auth/admin/list-users?limit=100`

---

### Public Room Catalog & Availability (`/api/rooms`)

Publicly accessible without logging in.

```http
GET /api/rooms
GET /api/rooms?available_from=2026-10-20&available_to=2026-10-23
```
Filters out rooms with overlapping `Booked` or `Checked-In` reservations.

---

### Reference Data APIs

Available to authenticated staff:

```http
GET /api/branches
GET /api/room-types
GET /api/amenities
GET /api/services
GET /api/guests?limit=20&offset=0
```

---

### Hotel Operations & Bookings (`/api/bookings`)

#### 1. Create a Booking (Staff)
```http
POST /api/bookings
Content-Type: application/json

{
  "guest_public_id": "UUID_FROM_GUESTS_RESPONSE",
  "room_public_ids": ["UUID_ROOM_1", "UUID_ROOM_2"],
  "check_in_time": "2026-11-10T14:00:00",
  "check_out_time": "2026-11-13T11:00:00",
  "booking_status": "Booked"
}
```
*Validation:* Rejects requests if rooms belong to different branches, or if any room is already booked for overlapping dates.

#### 2. List Bookings
```http
GET /api/bookings
GET /api/bookings?status=Checked-In
```

#### 3. Update Booking Status & Dates
```http
PATCH /api/bookings/:publicId
Content-Type: application/json

{
  "booking_status": "Checked-Out"
}
```
*Validation:* Checking out with outstanding dues (`outstanding_amount > 0`) is blocked by both the route handler and database triggers.

---

### Billing & Payments

#### 1. Calculate / Refresh Bill
Manually trigger bill recalculation via `sp_calculate_bill`:
```http
POST /api/calculate-bill
Content-Type: application/json

{
  "booking_public_id": "UUID_FROM_BOOKINGS_RESPONSE"
}
```

#### 2. Record a Payment
```http
POST /api/bookings/:publicId/payments
Content-Type: application/json

{
  "payment_method": "Card",
  "amount": 25000
}
```
Automatically invokes `sp_calculate_bill` and updates outstanding balance and payment status.

---

### Cancellation Management

```http
POST /api/cancel-booking
Content-Type: application/json

{
  "booking_public_id": "UUID_FROM_BOOKINGS_RESPONSE"
}
```
Invokes `sp_cancel_booking`, evaluates policy notice tiers, records cancellation fees, and updates room availability.

---

### Service Catalogue & Requests

#### 1. Manage Service Catalogue (Admin / Manager)
```http
POST   /api/services
PATCH  /api/services/:publicId
DELETE /api/services/:publicId
```

#### 2. Record Service Usage (Staff)
```http
POST /api/bookings/:publicId/services
Content-Type: application/json

{
  "service_public_id": "UUID_FROM_SERVICES",
  "room_public_id": "UUID_FROM_ROOMS",
  "quantity": 2
}
```

#### 3. Manage Guest Service Requests (Staff)
```http
GET    /api/service-requests
PATCH  /api/service-requests/:publicId/complete
DELETE /api/service-requests/:publicId
```

---

### Guest Self-Service Portal (`/api/guest`)

Endpoints accessible to authenticated users with role `guest`:

```http
GET    /api/guest/profile
GET    /api/guest/bookings
POST   /api/guest/bookings
POST   /api/guest/bookings/:publicId/cancel
POST   /api/guest/bookings/:publicId/services
DELETE /api/guest/service-requests/:publicId
POST   /api/guest/bookings/:publicId/payments
```

---

### Management & Analytical Reports (`/api/reports`)

Query pre-aggregated database views with optional query filters:

#### 1. Room Occupancy Report
```http
GET /api/reports/occupancy?from=2026-10-01&to=2026-10-31
```
*Backing View:* `report_occupancy`

#### 2. Guest Billing Summary
```http
GET /api/reports/billing
```
*Backing View:* `report_guest_billing` (includes paid amounts and outstanding dues).

#### 3. Service Usage Breakdown
```http
GET /api/reports/service-usage?from=2026-10-01&to=2026-11-01
```
*Backing View:* `report_service_usage` (grouped by room and service catalogue item).

#### 4. Monthly Revenue per Branch
```http
GET /api/reports/revenue?from=2026-10-01&to=2026-11-01
```
*Backing View:* `report_revenue` (cleanly segregates room and service revenues by branch).

#### 5. Top-Used Services
```http
GET /api/reports/top-services
```
*Backing View:* `report_top_services` (ranks service popularity and revenue contribution).

---

### Hotel Management Settings (`/api/management/settings`)

Endpoints for reading and modifying operational hotel parameters (standard check-in/out times, contact details, hotel name), backed by the `hotel_config` table:

#### 1. Get Operational Settings
```http
GET /api/management/settings
```
*Roles:* `admin`, `manager`, `front_desk`, `service_staff`  
*Response:*
```json
{
  "data": {
    "hotelName": "SkyNest Hotels",
    "contactEmail": "contact@skynest.page",
    "contactPhone": "0760218879",
    "checkInTime": "14:00",
    "checkOutTime": "11:00",
    "revision": 1
  }
}
```

#### 2. Update Operational Settings
```http
PUT /api/management/settings
Content-Type: application/json

{
  "hotelName": "SkyNest Hotels",
  "contactEmail": "admin@skynest.page",
  "contactPhone": "0760218879",
  "checkInTime": "14:00",
  "checkOutTime": "11:00",
  "revision": 1
}
```
*Roles:* `admin`, `manager`  
*Action:* Executes an atomic MySQL transaction with `ON DUPLICATE KEY UPDATE` across `hotel_config`, increments the `settings_revision` counter for optimistic concurrency, and broadcasts a `settings:updated` event to staff clients over WebSockets.

---

## Real-Time Staff Notifications (WebSockets)

Staff dashboards receive real-time notifications via **Socket.io**. Connect with credentials:

```js
import { io } from 'socket.io-client';

const socket = io('http://localhost:4000', {
  withCredentials: true,
});

socket.on('notification', ({ type, message, data }) => {
  console.log(`[Event: ${type}] ${message}`, data);
});
```

### Supported Notification Events

| Event Type | Trigger |
| :--- | :--- |
| `booking.created` | New reservation made by staff or guest |
| `booking.updated` | Booking dates, status, or check-in updated |
| `booking.cancelled` | Reservation cancelled |
| `booking.bill_recalculated` | Total bill recalculated |
| `payment.created` | Payment recorded against a booking |
| `service_request.created` | Guest submitted an in-room service request |
| `service_request.completed` | Staff fulfilled a service request |
| `service_request.cancelled` | Service request cancelled |
| `guest.created`, `guest.updated`, `guest.deleted` | Guest profile changes |
| `service_catalogue.created`, `updated`, `deleted` | Catalogue modifications |
| `settings:updated` | Hotel management settings updated |

---

## Testing & Quality Assurance

### Run All Test Suites
Runs database trigger tests followed by integration HTTP API tests:
```bash
npm test
```

### Run Specific Test Suites
```bash
# Database Triggers & Stored Procedures test suite:
npm run db:test-triggers

# Integration HTTP API test suite:
npm run api:test
```

### API Test Logging Flags
When troubleshooting API test failures, use flags for deeper visibility:
```bash
# Concise pass/fail output (default)
npm run api:test

# Verbose: prints requests, headers, and response payloads
npm run api:test -- --verbose

# Debug: prints full traces and stack traces
npm run api:test -- --debug

# Quiet: prints summary only
npm run api:test -- --quiet
```

### Code Formatting & Linting
```bash
# Run ESLint:
npm run lint

# Check code formatting:
npm run format:check

# Auto-format codebase:
npm run format
```
