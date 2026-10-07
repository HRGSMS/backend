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