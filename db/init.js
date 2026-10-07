import { pool } from '../src/config/db.js';

const tableDefinitions = [
  `
    CREATE TABLE IF NOT EXISTS \`Guest\` (
      \`GuestID\` INT NOT NULL,
      \`FirstName\` VARCHAR(20),
      \`LastName\` VARCHAR(20),
      \`Email\` VARCHAR(30),
      \`PhoneNumber\` VARCHAR(20),
      PRIMARY KEY (\`GuestID\`)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS \`Branch\` (
      \`BranchID\` INT NOT NULL,
      \`Name\` VARCHAR(100),
      \`LocationCity\` VARCHAR(100),
      PRIMARY KEY (\`BranchID\`)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS \`Tax rates\` (
      \`TaxID\` INT NOT NULL,
      \`Rate\` DECIMAL(10, 2),
      \`BranchID\` INT NOT NULL,
      PRIMARY KEY (\`TaxID\`),
      FOREIGN KEY (\`BranchID\`) REFERENCES \`Branch\`(\`BranchID\`)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS \`Booking\` (
      \`BookingID\` INT NOT NULL,
      \`GuestID\` INT NOT NULL,
      \`BookingTime\` DATETIME,
      \`CheckInTime\` DATETIME,
      \`CheckOutTime\` DATETIME,
      \`CancellationTime\` DATETIME,
      \`BookingStatus\` VARCHAR(15),
      \`PaymentStatus\` VARCHAR(20),
      \`TotalCharge\` DECIMAL(10, 2),
      \`OutstandingAmount\` DECIMAL(10, 2),
      \`TaxID\` INT,
      \`TotalTaxAmount\` DECIMAL(10, 2),
      PRIMARY KEY (\`BookingID\`),
      FOREIGN KEY (\`GuestID\`) REFERENCES \`Guest\`(\`GuestID\`),
      FOREIGN KEY (\`TaxID\`) REFERENCES \`Tax rates\`(\`TaxID\`)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS \`Payment\` (
      \`PaymentID\` INT NOT NULL,
      \`BookingID\` INT NOT NULL,
      \`PaymentDate\` DATETIME,
      \`PaymentMethod\` VARCHAR(20),
      \`Amount\` DECIMAL(10, 2),
      PRIMARY KEY (\`PaymentID\`),
      FOREIGN KEY (\`BookingID\`) REFERENCES \`Booking\`(\`BookingID\`)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS \`RoomType\` (
      \`RoomTypeID\` INT NOT NULL,
      \`TypeName\` VARCHAR(20),
      \`RoomTypeDescription\` VARCHAR(100),
      \`Capacity\` INT,
      \`DailyRate\` DECIMAL(10, 2),
      \`RateUpdateTime\` DATETIME,
      PRIMARY KEY (\`RoomTypeID\`)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS \`Room\` (
      \`RoomID\` INT NOT NULL,
      \`BranchID\` INT NOT NULL,
      \`RoomTypeID\` INT NOT NULL,
      \`RoomNumber\` VARCHAR(5),
      \`CurrentStatus\` BOOLEAN,
      \`BookingAvailability\` BOOLEAN,
      PRIMARY KEY (\`RoomID\`),
      FOREIGN KEY (\`RoomTypeID\`) REFERENCES \`RoomType\`(\`RoomTypeID\`),
      FOREIGN KEY (\`BranchID\`) REFERENCES \`Branch\`(\`BranchID\`)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS \`ServiceCatalogue\` (
      \`ServiceID\` INT NOT NULL,
      \`ServiceName\` VARCHAR(20),
      \`ServiceDescription\` VARCHAR(100),
      \`CurrentPrice\` DECIMAL(10, 2),
      \`PriceUpdateTime\` DATETIME,
      \`TaxID\` INT,
      PRIMARY KEY (\`ServiceID\`),
      FOREIGN KEY (\`TaxID\`) REFERENCES \`Tax rates\`(\`TaxID\`)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS \`Ameneties\` (
      \`AmenetyID\` INT NOT NULL,
      \`AmenetyName\` VARCHAR(20),
      \`AmenetyDesc\` VARCHAR(50),
      PRIMARY KEY (\`AmenetyID\`)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS \`RoomAmeneties\` (
      \`AmenetyID\` INT NOT NULL,
      \`RoomTypeID\` INT NOT NULL,
      PRIMARY KEY (\`AmenetyID\`, \`RoomTypeID\`),
      FOREIGN KEY (\`RoomTypeID\`) REFERENCES \`RoomType\`(\`RoomTypeID\`),
      FOREIGN KEY (\`AmenetyID\`) REFERENCES \`Ameneties\`(\`AmenetyID\`)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS \`BookingRooms\` (
      \`BookingID\` INT NOT NULL,
      \`RoomID\` INT NOT NULL,
      \`PriceAtBooking\` DECIMAL(10, 2),
      PRIMARY KEY (\`BookingID\`, \`RoomID\`),
      FOREIGN KEY (\`RoomID\`) REFERENCES \`Room\`(\`RoomID\`),
      FOREIGN KEY (\`BookingID\`) REFERENCES \`Booking\`(\`BookingID\`)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS \`ServiceUsage\` (
      \`UsageID\` INT NOT NULL,
      \`BookingID\` INT NOT NULL,
      \`ServiceID\` INT NOT NULL,
      \`RoomID\` INT NOT NULL,
      \`UsageTime\` DATETIME,
      \`Quantity\` INT,
      \`PriceAtUsage\` DECIMAL(10, 2),
      PRIMARY KEY (\`UsageID\`),
      FOREIGN KEY (\`RoomID\`) REFERENCES \`Room\`(\`RoomID\`),
      FOREIGN KEY (\`BookingID\`) REFERENCES \`Booking\`(\`BookingID\`),
      FOREIGN KEY (\`ServiceID\`) REFERENCES \`ServiceCatalogue\`(\`ServiceID\`)
    )
  `,
];

export async function initializeDatabase() {
  const connection = await pool.getConnection();

  try {
    for (const definition of tableDefinitions) {
      await connection.query(definition);
    }

    console.log('Database tables initialized');
  } finally {
    connection.release();
    await pool.end();
  }
}
