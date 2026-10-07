import mysql from 'mysql2/promise';
import 'dotenv/config';

const databaseName = process.env.DB_NAME || 'hrgsms';
const connectionOptions = {
	host: process.env.DB_HOST || 'localhost',
	port: Number(process.env.DB_PORT || 3306),
	user: process.env.DB_USER || 'root',
	password: process.env.DB_PASSWORD || '',
	multipleStatements: false,
};

// BetterAuth required tables
const authSchemaStatements = [
	// Users table (BetterAuth standard)
	`CREATE TABLE IF NOT EXISTS \`user\` (
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
	) ENGINE=InnoDB`,

	// Sessions table (BetterAuth standard)
	`CREATE TABLE IF NOT EXISTS \`session\` (
		id VARCHAR(36) PRIMARY KEY,
		expiresAt DATETIME NOT NULL,
		token VARCHAR(255) NOT NULL,
		createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
		ipAddress VARCHAR(45),
		userAgent TEXT,
		userId VARCHAR(36) NOT NULL,
		UNIQUE KEY uq_session_token (token),
		KEY idx_session_user (userId),
		CONSTRAINT fk_session_user FOREIGN KEY (userId) REFERENCES \`user\` (id) ON DELETE CASCADE
	) ENGINE=InnoDB`,

	// Accounts table (BetterAuth standard for OAuth)
	`CREATE TABLE IF NOT EXISTS \`account\` (
		id VARCHAR(36) PRIMARY KEY,
		accountId VARCHAR(255) NOT NULL,
		providerId VARCHAR(255) NOT NULL,
		userId VARCHAR(36) NOT NULL,
		accessToken TEXT,
		refreshToken TEXT,
		idToken TEXT,
		accessTokenExpiresAt DATETIME,
		refreshTokenExpiresAt DATETIME,
		scope TEXT,
		password VARCHAR(255),
		createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
		KEY idx_account_user (userId),
		UNIQUE KEY uq_account_provider (providerId, accountId),
		CONSTRAINT fk_account_user FOREIGN KEY (userId) REFERENCES \`user\` (id) ON DELETE CASCADE
	) ENGINE=InnoDB`,

	// Verification tokens table (BetterAuth standard)
	`CREATE TABLE IF NOT EXISTS \`verification\` (
		id VARCHAR(36) PRIMARY KEY,
		identifier VARCHAR(255) NOT NULL,
		value VARCHAR(255) NOT NULL,
		expiresAt DATETIME NOT NULL,
		createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
		UNIQUE KEY uq_verification_identifier_value (identifier, value)
	) ENGINE=InnoDB`,
];

// Create the tables in dependency order so every foreign key is valid.
const schemaStatements = [
	...authSchemaStatements,
	`CREATE TABLE IF NOT EXISTS Branch (
		BranchID INT PRIMARY KEY,
		Name VARCHAR(100) NOT NULL,
		LocationCity VARCHAR(100) NOT NULL,
		UNIQUE KEY uq_branch_name (Name)
	) ENGINE=InnoDB`,
	`CREATE TABLE IF NOT EXISTS \`Tax rates\` (
		TaxID INT PRIMARY KEY,
		Rate DECIMAL(5,2) NOT NULL,
		BranchID INT NOT NULL,
		CONSTRAINT fk_tax_branch FOREIGN KEY (BranchID) REFERENCES Branch (BranchID),
		UNIQUE KEY uq_tax_branch (BranchID)
	) ENGINE=InnoDB`,
	`CREATE TABLE IF NOT EXISTS Guest (
		GuestID INT PRIMARY KEY,
		FirstName VARCHAR(50) NOT NULL,
		LastName VARCHAR(50) NOT NULL,
		Email VARCHAR(120) NOT NULL,
		PhoneNumber VARCHAR(20) NOT NULL,
		UNIQUE KEY uq_guest_email (Email)
	) ENGINE=InnoDB`,
	`CREATE TABLE IF NOT EXISTS RoomType (
		RoomTypeID INT PRIMARY KEY,
		TypeName VARCHAR(20) NOT NULL,
		RoomTypeDescription VARCHAR(255) NOT NULL,
		Capacity INT NOT NULL,
		DailyRate DECIMAL(10,2) NOT NULL,
		RateUpdateTime DATETIME NOT NULL,
		UNIQUE KEY uq_room_type_name (TypeName),
		CONSTRAINT chk_room_capacity CHECK (Capacity > 0),
		CONSTRAINT chk_room_rate CHECK (DailyRate >= 0)
	) ENGINE=InnoDB`,
	`CREATE TABLE IF NOT EXISTS Room (
		RoomID INT PRIMARY KEY,
		BranchID INT NOT NULL,
		RoomTypeID INT NOT NULL,
		RoomNumber VARCHAR(5) NOT NULL,
		CurrentStatus ENUM('Available', 'Occupied', 'Maintenance') NOT NULL DEFAULT 'Available',
		BookingAvailability BOOLEAN NOT NULL DEFAULT TRUE,
		UNIQUE KEY uq_room_branch_number (BranchID, RoomNumber),
		KEY idx_room_branch_status (BranchID, CurrentStatus),
		CONSTRAINT fk_room_branch FOREIGN KEY (BranchID) REFERENCES Branch (BranchID),
		CONSTRAINT fk_room_type FOREIGN KEY (RoomTypeID) REFERENCES RoomType (RoomTypeID)
	) ENGINE=InnoDB`,
	`CREATE TABLE IF NOT EXISTS ServiceCatalogue (
		ServiceID INT PRIMARY KEY,
		ServiceName VARCHAR(50) NOT NULL,
		ServiceDescription VARCHAR(255) NOT NULL,
		CurrentPrice DECIMAL(10,2) NOT NULL,
		PriceUpdateTime DATETIME NOT NULL,
		TaxID INT NOT NULL,
		UNIQUE KEY uq_service_name (ServiceName),
		CONSTRAINT fk_service_tax FOREIGN KEY (TaxID) REFERENCES \`Tax rates\` (TaxID),
		CONSTRAINT chk_service_price CHECK (CurrentPrice >= 0)
	) ENGINE=InnoDB`,
	`CREATE TABLE IF NOT EXISTS Booking (
		BookingID INT PRIMARY KEY,
		GuestID INT NOT NULL,
		BookingTime DATETIME NOT NULL,
		CheckInTime DATETIME NOT NULL,
		CheckOutTime DATETIME NOT NULL,
		CancellationTime DATETIME NULL,
		BookingStatus ENUM('Booked', 'Checked-In', 'Checked-Out', 'Cancelled') NOT NULL DEFAULT 'Booked',
		PaymentStatus ENUM('Unpaid', 'Partially Paid', 'Paid', 'Refunded') NOT NULL DEFAULT 'Unpaid',
		TotalCharge DECIMAL(10,2) NOT NULL DEFAULT 0,
		OutstandingAmount DECIMAL(10,2) NOT NULL DEFAULT 0,
		TaxID INT NOT NULL,
		TotalTaxAmount DECIMAL(10,2) NOT NULL DEFAULT 0,
		KEY idx_booking_dates (CheckInTime, CheckOutTime),
		KEY idx_booking_guest_status (GuestID, BookingStatus),
		CONSTRAINT fk_booking_guest FOREIGN KEY (GuestID) REFERENCES Guest (GuestID),
		CONSTRAINT fk_booking_tax FOREIGN KEY (TaxID) REFERENCES \`Tax rates\` (TaxID),
		CONSTRAINT chk_booking_dates CHECK (CheckOutTime > CheckInTime)
	) ENGINE=InnoDB`,
	`CREATE TABLE IF NOT EXISTS BookingRooms (
		BookingID INT NOT NULL,
		RoomID INT NOT NULL,
		PriceAtBooking DECIMAL(10,2) NOT NULL,
		PRIMARY KEY (BookingID, RoomID),
		KEY idx_booking_rooms_room (RoomID, BookingID),
		CONSTRAINT fk_booking_rooms_booking FOREIGN KEY (BookingID) REFERENCES Booking (BookingID),
		CONSTRAINT fk_booking_rooms_room FOREIGN KEY (RoomID) REFERENCES Room (RoomID),
		CONSTRAINT chk_booking_room_price CHECK (PriceAtBooking >= 0)
	) ENGINE=InnoDB`,
	`CREATE TABLE IF NOT EXISTS Payment (
		PaymentID INT PRIMARY KEY,
		BookingID INT NOT NULL,
		PaymentDate DATETIME NOT NULL,
		PaymentMethod ENUM('Cash', 'Card', 'Bank Transfer', 'Online') NOT NULL,
		Amount DECIMAL(10,2) NOT NULL,
		KEY idx_payment_booking_date (BookingID, PaymentDate),
		CONSTRAINT fk_payment_booking FOREIGN KEY (BookingID) REFERENCES Booking (BookingID),
		CONSTRAINT chk_payment_amount CHECK (Amount > 0)
	) ENGINE=InnoDB`,
	`CREATE TABLE IF NOT EXISTS ServiceUsage (
		UsageID INT PRIMARY KEY,
		BookingID INT NOT NULL,
		ServiceID INT NOT NULL,
		RoomID INT NOT NULL,
		UsageTime DATETIME NOT NULL,
		Quantity INT NOT NULL,
		PriceAtUsage DECIMAL(10,2) NOT NULL,
		KEY idx_usage_booking_time (BookingID, UsageTime),
		KEY idx_usage_service (ServiceID),
		CONSTRAINT fk_usage_booking FOREIGN KEY (BookingID) REFERENCES Booking (BookingID),
		CONSTRAINT fk_usage_service FOREIGN KEY (ServiceID) REFERENCES ServiceCatalogue (ServiceID),
		CONSTRAINT fk_usage_room FOREIGN KEY (RoomID) REFERENCES Room (RoomID),
		CONSTRAINT chk_usage_quantity CHECK (Quantity > 0),
		CONSTRAINT chk_usage_price CHECK (PriceAtUsage >= 0)
	) ENGINE=InnoDB`,
	`CREATE TABLE IF NOT EXISTS Ameneties (
		AmenetyID INT PRIMARY KEY,
		AmenetyName VARCHAR(50) NOT NULL,
		AmenetyDesc VARCHAR(255) NOT NULL,
		UNIQUE KEY uq_amenity_name (AmenetyName)
	) ENGINE=InnoDB`,
	`CREATE TABLE IF NOT EXISTS RoomAmeneties (
		AmenetyID INT NOT NULL,
		RoomTypeID INT NOT NULL,
		PRIMARY KEY (AmenetyID, RoomTypeID),
		CONSTRAINT fk_room_amenity_amenity FOREIGN KEY (AmenetyID) REFERENCES Ameneties (AmenetyID),
		CONSTRAINT fk_room_amenity_type FOREIGN KEY (RoomTypeID) REFERENCES RoomType (RoomTypeID)
	) ENGINE=InnoDB`,
	`CREATE TABLE IF NOT EXISTS RoomAvailability (
		AvailabilityID INT PRIMARY KEY,
		RoomID INT NOT NULL,
		AvailabilityDate DATE NOT NULL,
		Status ENUM('Available', 'Reserved', 'Occupied', 'Maintenance') NOT NULL,
		UNIQUE KEY uq_room_availability_day (RoomID, AvailabilityDate),
		KEY idx_availability_date_status (AvailabilityDate, Status),
		CONSTRAINT fk_availability_room FOREIGN KEY (RoomID) REFERENCES Room (RoomID)
	) ENGINE=InnoDB`,
];

// Seed a complete demonstration dataset; duplicate-key updates make reruns safe.
const seedStatements = [
	// Auth users seed - run after tables are created
	`INSERT INTO \`user\` (id, name, email, emailVerified, role, branchId, createdAt) VALUES
		('usr_frontdesk_001', 'Front Desk User', 'frontdesk@hotel.com', TRUE, 'FrontDesk', 1, NOW()),
		('usr_manager_001', 'Hotel Manager', 'manager@hotel.com', TRUE, 'Manager', 1, NOW()),
		('usr_admin_001', 'System Admin', 'admin@hotel.com', TRUE, 'Admin', NULL, NOW())
		ON DUPLICATE KEY UPDATE
			name = VALUES(name),
			emailVerified = VALUES(emailVerified),
			role = VALUES(role),
			branchId = VALUES(branchId)`,

	// Passwords for auth accounts (stored in account table)
	`INSERT INTO \`account\` (id, accountId, providerId, userId, password, createdAt) VALUES
		('acc_frontdesk_001', 'frontdesk@hotel.com', 'email', 'usr_frontdesk_001', '$2a$10$XOp7ZQZ9K7eV5YqJ8K9L1uJ5YqJ8K9L1uJ5YqJ8K9L1uJ5YqJ8K9L1', NOW()),
		('acc_manager_001', 'manager@hotel.com', 'email', 'usr_manager_001', '$2a$10$XOp7ZQZ9K7eV5YqJ8K9L1uJ5YqJ8K9L1uJ5YqJ8K9L1uJ5YqJ8K9L1', NOW()),
		('acc_admin_001', 'admin@hotel.com', 'email', 'usr_admin_001', '$2a$10$XOp7ZQZ9K7eV5YqJ8K9L1uJ5YqJ8K9L1uJ5YqJ8K9L1uJ5YqJ8K9L1', NOW())
		ON DUPLICATE KEY UPDATE
			password = VALUES(password),
			updatedAt = NOW()`,

	`INSERT INTO Branch (BranchID, Name, LocationCity) VALUES
		(1, 'SkyNest Colombo', 'Colombo'), (2, 'SkyNest Kandy', 'Kandy'), (3, 'SkyNest Galle', 'Galle')
		ON DUPLICATE KEY UPDATE Name = VALUES(Name), LocationCity = VALUES(LocationCity)`,
	`INSERT INTO \`Tax rates\` (TaxID, Rate, BranchID) VALUES
		(1, 10.00, 1), (2, 10.00, 2), (3, 10.00, 3)
		ON DUPLICATE KEY UPDATE Rate = VALUES(Rate), BranchID = VALUES(BranchID)`,
	`INSERT INTO Guest (GuestID, FirstName, LastName, Email, PhoneNumber) VALUES
		(1, 'Amaya', 'Perera', 'amaya.perera@example.com', '+94771234567'),
		(2, 'Nimal', 'Fernando', 'nimal.fernando@example.com', '+94772345678'),
		(3, 'Sakura', 'Tanaka', 'sakura.tanaka@example.com', '+819012345678'),
		(4, 'Dilan', 'Jayasinghe', 'dilan.jayasinghe@example.com', '+94773456789'),
		(5, 'Maya', 'Silva', 'maya.silva@example.com', '+94774567890')
		ON DUPLICATE KEY UPDATE FirstName = VALUES(FirstName), LastName = VALUES(LastName), PhoneNumber = VALUES(PhoneNumber)`,
	`INSERT INTO RoomType (RoomTypeID, TypeName, RoomTypeDescription, Capacity, DailyRate, RateUpdateTime) VALUES
		(1, 'Single', 'Comfortable room for one guest', 1, 12000.00, '2026-01-01 09:00:00'),
		(2, 'Double', 'Room with two beds', 2, 18000.00, '2026-01-01 09:00:00'),
		(3, 'Deluxe', 'Larger room with city or garden view', 3, 26000.00, '2026-01-01 09:00:00'),
		(4, 'Suite', 'Separate living area and premium amenities', 4, 40000.00, '2026-01-01 09:00:00')
		ON DUPLICATE KEY UPDATE DailyRate = VALUES(DailyRate), RateUpdateTime = VALUES(RateUpdateTime)`,
	`INSERT INTO Room (RoomID, BranchID, RoomTypeID, RoomNumber, CurrentStatus, BookingAvailability) VALUES
		(1, 1, 1, '101', 'Available', TRUE), (2, 1, 2, '102', 'Available', TRUE),
		(3, 1, 3, '201', 'Available', TRUE), (4, 1, 4, '202', 'Available', TRUE),
		(5, 2, 1, '101', 'Available', TRUE), (6, 2, 2, '102', 'Available', TRUE),
		(7, 2, 3, '201', 'Available', TRUE), (8, 3, 2, '101', 'Available', TRUE),
		(9, 3, 3, '201', 'Available', TRUE), (10, 3, 4, '202', 'Available', TRUE)
		ON DUPLICATE KEY UPDATE RoomTypeID = VALUES(RoomTypeID), BookingAvailability = VALUES(BookingAvailability)`,
	`INSERT INTO ServiceCatalogue (ServiceID, ServiceName, ServiceDescription, CurrentPrice, PriceUpdateTime, TaxID) VALUES
		(1, 'Room Service', 'In-room meals and drinks', 3500.00, '2026-01-01 09:00:00', 1),
		(2, 'Spa Treatment', 'One-hour wellness treatment', 9000.00, '2026-01-01 09:00:00', 1),
		(3, 'Laundry', 'Standard laundry bag', 2500.00, '2026-01-01 09:00:00', 2),
		(4, 'Minibar', 'Minibar consumption item', 1800.00, '2026-01-01 09:00:00', 2),
		(5, 'Airport Transfer', 'One-way airport transfer', 12000.00, '2026-01-01 09:00:00', 3),
		(6, 'Breakfast', 'Breakfast buffet per guest', 3000.00, '2026-01-01 09:00:00', 3)
		ON DUPLICATE KEY UPDATE CurrentPrice = VALUES(CurrentPrice), PriceUpdateTime = VALUES(PriceUpdateTime)`,
	`INSERT INTO Ameneties (AmenetyID, AmenetyName, AmenetyDesc) VALUES
		(1, 'Wi-Fi', 'High-speed wireless internet'), (2, 'Air conditioning', 'Individually controlled air conditioning'),
		(3, 'Breakfast', 'Breakfast buffet access'), (4, 'Balcony', 'Private balcony'), (5, 'Bathtub', 'Premium bathtub')
		ON DUPLICATE KEY UPDATE AmenetyDesc = VALUES(AmenetyDesc)`,
	`INSERT INTO RoomAmeneties (AmenetyID, RoomTypeID) VALUES
		(1, 1), (2, 1), (1, 2), (2, 2), (3, 2), (1, 3), (2, 3), (4, 3),
		(1, 4), (2, 4), (3, 4), (4, 4), (5, 4)
		ON DUPLICATE KEY UPDATE AmenetyID = VALUES(AmenetyID)`,
	`INSERT INTO Booking (BookingID, GuestID, BookingTime, CheckInTime, CheckOutTime, BookingStatus, PaymentStatus, TaxID) VALUES
		(1, 1, '2026-08-01 10:00:00', '2026-08-10 14:00:00', '2026-08-13 11:00:00', 'Checked-Out', 'Paid', 1),
		(2, 2, '2026-08-05 12:00:00', '2026-08-15 14:00:00', '2026-08-17 11:00:00', 'Checked-Out', 'Partially Paid', 1),
		(3, 3, '2026-08-12 09:30:00', '2026-09-01 14:00:00', '2026-09-05 11:00:00', 'Checked-Out', 'Paid', 2),
		(4, 4, '2026-08-20 15:00:00', '2026-09-10 14:00:00', '2026-09-12 11:00:00', 'Checked-Out', 'Partially Paid', 3),
		(5, 5, '2026-09-01 11:00:00', '2026-09-20 14:00:00', '2026-09-22 11:00:00', 'Checked-Out', 'Paid', 3),
		(6, 1, '2026-09-03 13:00:00', '2026-10-05 14:00:00', '2026-10-08 11:00:00', 'Booked', 'Partially Paid', 1),
		(7, 2, '2026-09-05 10:30:00', '2026-10-10 14:00:00', '2026-10-12 11:00:00', 'Booked', 'Unpaid', 2),
		(8, 3, '2026-09-08 16:00:00', '2026-10-15 14:00:00', '2026-10-18 11:00:00', 'Booked', 'Unpaid', 3)
		ON DUPLICATE KEY UPDATE CheckInTime = VALUES(CheckInTime), CheckOutTime = VALUES(CheckOutTime), BookingStatus = VALUES(BookingStatus)`,
	`INSERT INTO BookingRooms (BookingID, RoomID, PriceAtBooking) VALUES
		(1, 1, 12000.00), (2, 2, 18000.00), (3, 5, 12000.00), (4, 8, 18000.00),
		(5, 9, 26000.00), (6, 3, 26000.00), (7, 6, 18000.00), (8, 10, 40000.00)
		ON DUPLICATE KEY UPDATE PriceAtBooking = VALUES(PriceAtBooking)`,
	`INSERT INTO ServiceUsage (UsageID, BookingID, ServiceID, RoomID, UsageTime, Quantity, PriceAtUsage) VALUES
		(1, 1, 1, 1, '2026-08-11 19:00:00', 2, 3500.00), (2, 1, 6, 1, '2026-08-12 08:00:00', 2, 3000.00),
		(3, 2, 3, 2, '2026-08-16 18:00:00', 1, 2500.00), (4, 3, 2, 5, '2026-09-02 16:00:00', 1, 9000.00),
		(5, 4, 4, 8, '2026-09-11 21:00:00', 2, 1800.00), (6, 5, 5, 9, '2026-09-20 12:00:00', 1, 12000.00)
		ON DUPLICATE KEY UPDATE Quantity = VALUES(Quantity), PriceAtUsage = VALUES(PriceAtUsage)`,
	`INSERT INTO Payment (PaymentID, BookingID, PaymentDate, PaymentMethod, Amount) VALUES
		(1, 1, '2026-08-01 10:05:00', 'Card', 50000.00), (2, 1, '2026-08-13 10:00:00', 'Card', 9000.00),
		(3, 2, '2026-08-05 12:05:00', 'Online', 20000.00), (4, 3, '2026-08-12 09:35:00', 'Bank Transfer', 70000.00),
		(5, 4, '2026-08-20 15:05:00', 'Cash', 15000.00), (6, 5, '2026-09-01 11:05:00', 'Card', 90000.00),
		(7, 6, '2026-09-03 13:05:00', 'Online', 10000.00)
		ON DUPLICATE KEY UPDATE Amount = VALUES(Amount), PaymentMethod = VALUES(PaymentMethod)`,
	`INSERT INTO RoomAvailability (AvailabilityID, RoomID, AvailabilityDate, Status) VALUES
		(1, 1, '2026-10-05', 'Reserved'), (2, 2, '2026-10-10', 'Reserved'), (3, 3, '2026-10-05', 'Available'),
		(4, 4, '2026-10-05', 'Available'), (5, 5, '2026-09-01', 'Available'), (6, 6, '2026-10-10', 'Reserved'),
		(7, 7, '2026-10-10', 'Available'), (8, 8, '2026-09-10', 'Available'), (9, 9, '2026-09-20', 'Available'),
		(10, 10, '2026-10-15', 'Reserved')
		ON DUPLICATE KEY UPDATE Status = VALUES(Status)`,
];

// Database routines enforce booking and payment rules close to the data.
const routineStatements = [
	'DROP TRIGGER IF EXISTS trg_booking_room_no_overlap',
	`CREATE TRIGGER trg_booking_room_no_overlap BEFORE INSERT ON BookingRooms FOR EACH ROW
	 BEGIN
		 -- Lock the overlap check to the booking's requested stay period.
		 DECLARE requestedIn DATETIME;
		 DECLARE requestedOut DATETIME;
		 SELECT CheckInTime, CheckOutTime INTO requestedIn, requestedOut FROM Booking WHERE BookingID = NEW.BookingID;
		 IF EXISTS (SELECT 1 FROM BookingRooms br JOIN Booking b ON b.BookingID = br.BookingID
			 WHERE br.RoomID = NEW.RoomID AND b.BookingStatus IN ('Booked', 'Checked-In')
			 AND b.CheckInTime < requestedOut AND b.CheckOutTime > requestedIn) THEN
			 SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Room is already booked for the requested period';
		 END IF;
	 END`,
	'DROP TRIGGER IF EXISTS trg_payment_refresh_booking',
	`CREATE TRIGGER trg_payment_refresh_booking AFTER INSERT ON Payment FOR EACH ROW
	 BEGIN
		 UPDATE Booking b SET b.OutstandingAmount = GREATEST(b.TotalCharge - (SELECT COALESCE(SUM(p.Amount), 0) FROM Payment p WHERE p.BookingID = NEW.BookingID), 0),
			 b.PaymentStatus = CASE WHEN (SELECT COALESCE(SUM(p.Amount), 0) FROM Payment p WHERE p.BookingID = NEW.BookingID) >= b.TotalCharge THEN 'Paid' ELSE 'Partially Paid' END
			 WHERE b.BookingID = NEW.BookingID;
	 END`,
	'DROP PROCEDURE IF EXISTS CalculateBookingTotal',
	`CREATE PROCEDURE CalculateBookingTotal(IN targetBookingID INT)
	 BEGIN
		 -- Rebuild totals from recorded room rates and service prices, never current catalogue prices.
		 UPDATE Booking b JOIN (SELECT br.BookingID, SUM(br.PriceAtBooking * DATEDIFF(bk.CheckOutTime, bk.CheckInTime)) roomTotal
			 FROM BookingRooms br JOIN Booking bk ON bk.BookingID = br.BookingID WHERE br.BookingID = targetBookingID GROUP BY br.BookingID) r ON r.BookingID = b.BookingID
			 SET b.TotalCharge = r.roomTotal + COALESCE((SELECT SUM(su.Quantity * su.PriceAtUsage) FROM ServiceUsage su WHERE su.BookingID = targetBookingID), 0),
					 b.TotalTaxAmount = b.TotalCharge * (SELECT Rate / 100 FROM \`Tax rates\` tr WHERE tr.TaxID = b.TaxID),
					   b.OutstandingAmount = GREATEST(b.TotalCharge + b.TotalTaxAmount - COALESCE((SELECT SUM(p.Amount) FROM Payment p WHERE p.BookingID = targetBookingID), 0), 0),
					   b.PaymentStatus = CASE WHEN COALESCE((SELECT SUM(p.Amount) FROM Payment p WHERE p.BookingID = targetBookingID), 0) >= b.TotalCharge + b.TotalTaxAmount THEN 'Paid' ELSE 'Partially Paid' END
			 WHERE b.BookingID = targetBookingID;
	 END`,
	'DROP PROCEDURE IF EXISTS CheckOutBooking',
	`CREATE PROCEDURE CheckOutBooking(IN targetBookingID INT)
	 BEGIN
		 -- Checkout is rejected until the tax-inclusive balance has been settled.
		 CALL CalculateBookingTotal(targetBookingID);
		 IF (SELECT OutstandingAmount FROM Booking WHERE BookingID = targetBookingID) > 0 THEN
			 SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Booking has an outstanding balance';
		 END IF;
		 UPDATE Booking SET BookingStatus = 'Checked-Out' WHERE BookingID = targetBookingID;
		 UPDATE Room r JOIN BookingRooms br ON br.RoomID = r.RoomID SET r.CurrentStatus = 'Available' WHERE br.BookingID = targetBookingID;
	 END`,
	'CALL CalculateBookingTotal(1)',
	'CALL CalculateBookingTotal(2)',
	'CALL CalculateBookingTotal(3)',
	'CALL CalculateBookingTotal(4)',
	'CALL CalculateBookingTotal(5)',
	'CALL CalculateBookingTotal(6)',
	'CALL CalculateBookingTotal(7)',
	'CALL CalculateBookingTotal(8)',
];

// Views provide stable query surfaces for the required management reports.
const reportViews = [
	'DROP VIEW IF EXISTS v_guest_billing_summary',
	`CREATE VIEW v_guest_billing_summary AS SELECT b.BookingID, CONCAT(g.FirstName, ' ', g.LastName) GuestName, b.TotalCharge, b.TotalTaxAmount,
		COALESCE(SUM(p.Amount), 0) PaidAmount, GREATEST(b.TotalCharge + b.TotalTaxAmount - COALESCE(SUM(p.Amount), 0), 0) OutstandingAmount,
		b.PaymentStatus, b.BookingStatus FROM Booking b JOIN Guest g ON g.GuestID = b.GuestID LEFT JOIN Payment p ON p.BookingID = b.BookingID GROUP BY b.BookingID`,
	'DROP VIEW IF EXISTS v_monthly_branch_revenue',
	`CREATE VIEW v_monthly_branch_revenue AS SELECT r.BranchID, br.Name BranchName, DATE_FORMAT(b.CheckOutTime, '%Y-%m') RevenueMonth,
		SUM(brp.PriceAtBooking * DATEDIFF(b.CheckOutTime, b.CheckInTime)) RoomRevenue,
		COALESCE((SELECT SUM(su.Quantity * su.PriceAtUsage) FROM ServiceUsage su WHERE su.BookingID = b.BookingID), 0) ServiceRevenue
		FROM Booking b JOIN BookingRooms brp ON brp.BookingID = b.BookingID JOIN Room r ON r.RoomID = brp.RoomID JOIN Branch br ON br.BranchID = r.BranchID
		WHERE b.BookingStatus = 'Checked-Out' GROUP BY r.BranchID, br.Name, RevenueMonth, b.BookingID`,
];

async function migrate() {
	const connection = await mysql.createConnection(connectionOptions);
	try {
		// Create the configured database before selecting it for the migration.
		await connection.query(`CREATE DATABASE IF NOT EXISTS \`${databaseName.replaceAll('`', '``')}\``);
		await connection.query(`USE \`${databaseName.replaceAll('`', '``')}\``);
		// Keep table creation and seed data atomic; routines and views are recreated afterward.
		await connection.beginTransaction();
		for (const statement of schemaStatements) await connection.query(statement);
		for (const statement of seedStatements) await connection.query(statement);
		await connection.commit();

		let routinesInstalled = true;
		try {
			for (const statement of routineStatements) await connection.query(statement);
		} catch (error) {
			if (error.code === 'ER_BINLOG_UNSAFE_ROUTINE' || error.errno === 1419) {
				routinesInstalled = false;
				console.warn(
					'Warning: MySQL skipped triggers/procedures because binary logging requires SUPER or log_bin_trust_function_creators=1.',
				);
			} else {
				throw error;
			}
		}
		for (const statement of reportViews) await connection.query(statement);
		console.log(
			`HRGSMS database '${databaseName}' initialized and seeded${routinesInstalled ? '.' : '; routines were skipped.'}`,
		);
	} catch (error) {
		await connection.rollback();
		console.error('Database initialization failed:', error.message);
		process.exitCode = 1;
	} finally {
		await connection.end();
	}
}

migrate();