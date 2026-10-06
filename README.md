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

check 
http://localhost:4000/api/health