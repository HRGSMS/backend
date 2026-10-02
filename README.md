# backend
The Backend Repository for HRGMS

## Database initialization

Copy `.env.example` to `.env`, set the MySQL credentials, and run:

```bash
npm run migrate
```

The migration creates the database, tables, indexes, overlap-prevention and
payment/check-out routines, reporting views, and the required sample data.

If MySQL has binary logging enabled, a database administrator must run
`SET GLOBAL log_bin_trust_function_creators = 1;` or grant the required
privilege before running the migration. Without that setting, the migration
still creates the tables, seed data, and reporting views, but skips triggers
and stored procedures.


check 
http://localhost:4000/api/health