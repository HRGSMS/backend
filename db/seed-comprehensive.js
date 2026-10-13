import { pool } from '../src/config/db.js';

/**
 * SkyNest Hotels - Comprehensive Extended Dataset with All Operational Edge Cases
 *
 * Covers:
 * 1. Multi-room bookings under a single reservation
 * 2. Same-day room turnover boundary (checkout 11:00 AM, next checkin 14:00 PM)
 * 3. All booking lifecycle states: Booked, Checked-In, Checked-Out, Cancelled
 * 4. All financial states: Paid, Partially Paid, Unpaid, Credit Due (overpayment/refund)
 * 5. Minimum stay (1-night) vs Extended long stay (14 nights)
 * 6. Diverse payment methods: Card, Cash, Bank Transfer
 * 7. Varied service usage: Zero services, single service, high-volume VIP services (5+),
 *    and varied service statuses: Completed, Pending
 * 8. Cancellation policies: Free cancellation (>72h), 1st night fee (24-71h),
 *    late cancellation fee (<24h) with services charged
 * 9. International and domestic guest profiles, plus registered guest with 0 bookings
 * 10. Automated bill calculation via sp_calculate_bill for 100% financial accuracy
 */

const branches = [
  [1, 'SkyNest Colombo', 'Colombo'],
  [2, 'SkyNest Kandy', 'Kandy'],
  [3, 'SkyNest Galle', 'Galle'],
];

const taxRates = [
  [1, 0.18, 1],
  [2, 0.18, 2],
  [3, 0.18, 3],
];

const roomTypes = [
  [
    1,
    'Single',
    'Compact luxury room tailored for single business travelers',
    1,
    15000,
    '2026-01-01 09:00:00',
  ],
  [
    2,
    'Double',
    'Cozy room with twin or queen bedding for two guests',
    2,
    22000,
    '2026-01-01 09:00:00',
  ],
  [
    3,
    'Deluxe',
    'Spacious room featuring king bed and panoramic balcony',
    2,
    30000,
    '2026-01-01 09:00:00',
  ],
  [
    4,
    'Family',
    'Two interconnected sleeping areas designed for families',
    4,
    42000,
    '2026-01-01 09:00:00',
  ],
  [
    5,
    'Executive Suite',
    'Premium suite with separate boardroom and lounge area',
    3,
    58000,
    '2026-01-01 09:00:00',
  ],
  [
    6,
    'Presidential Penthouse',
    'Top-floor panoramic residence with private plunge pool',
    6,
    95000,
    '2026-01-01 09:00:00',
  ],
];

const amenities = [
  [1, 'High-Speed Wi-Fi', 'Complimentary gigabit fiber connectivity'],
  [2, 'Climate Control AC', 'Individual multi-zone smart climate control'],
  [3, 'Gourmet Breakfast', 'Full continental & Sri Lankan breakfast buffet'],
  [4, 'Panoramic View', 'Direct ocean, lake, or mountain vistas'],
  [5, 'Stocked Minibar', 'Artisan snacks and chilled beverages'],
  [6, 'Private Jacuzzi', 'In-room hydrotherapy hot tub or plunge pool'],
  [7, 'Smart Automation', 'Automated curtains, mood lighting, and 4K screen'],
  [8, 'Butler Service', 'Dedicated 24/7 personal attendant'],
];

const roomAmenities = [
  [1, 1],
  [2, 1],
  [3, 1],
  [1, 2],
  [2, 2],
  [3, 2],
  [5, 2],
  [1, 3],
  [2, 3],
  [3, 3],
  [4, 3],
  [5, 3],
  [1, 4],
  [2, 4],
  [3, 4],
  [5, 4],
  [7, 4],
  [1, 5],
  [2, 5],
  [3, 5],
  [4, 5],
  [5, 5],
  [6, 5],
  [7, 5],
  [8, 5],
  [1, 6],
  [2, 6],
  [3, 6],
  [4, 6],
  [5, 6],
  [6, 6],
  [7, 6],
  [8, 6],
];

const rooms = [
  // Colombo (Branch 1)
  [101, 1, 1, 'C101', 0, 1],
  [102, 1, 2, 'C102', 0, 1],
  [103, 1, 3, 'C103', 0, 1],
  [104, 1, 3, 'C104', 1, 0], // Currently occupied by active booking 4
  [105, 1, 4, 'C105', 1, 0], // Currently occupied by active booking 4
  [106, 1, 5, 'C201', 0, 1],
  [107, 1, 6, 'C301', 0, 1],
  [108, 1, 1, 'C106', 0, 1],

  // Kandy (Branch 2)
  [201, 2, 1, 'K101', 0, 1],
  [202, 2, 2, 'K102', 0, 1],
  [203, 2, 3, 'K103', 0, 1],
  [204, 2, 4, 'K104', 0, 1],
  [205, 2, 5, 'K201', 0, 1],
  [206, 2, 6, 'K301', 0, 1],
  [207, 2, 2, 'K105', 0, 1],
  [208, 2, 3, 'K106', 0, 1],

  // Galle (Branch 3)
  [301, 3, 1, 'G101', 0, 1],
  [302, 3, 2, 'G102', 0, 1],
  [303, 3, 3, 'G103', 1, 0], // Currently occupied by active booking 3
  [304, 3, 3, 'G104', 0, 1],
  [305, 3, 4, 'G105', 0, 1],
  [306, 3, 5, 'G201', 0, 1],
  [307, 3, 5, 'G202', 1, 0], // Currently occupied by active booking 17
  [308, 3, 6, 'G301', 0, 1],
  [309, 3, 6, 'G302', 0, 1],
];

const services = [
  [
    1,
    'Gourmet Room Service',
    'Chef-prepared meals delivered to the room',
    4500,
    '2026-01-01 09:00:00',
    1,
  ],
  [
    2,
    'Ayurvedic Spa & Wellness',
    'Traditional herb and massage therapies (60 min)',
    14000,
    '2026-01-01 09:00:00',
    1,
  ],
  [
    3,
    'Express Laundry',
    'Same-day laundry, washing, and steam pressing',
    3500,
    '2026-01-01 09:00:00',
    1,
  ],
  [
    4,
    'Artisan Minibar Refill',
    'Assorted local nuts, confectionery, and spirits',
    3000,
    '2026-01-01 09:00:00',
    1,
  ],
  [
    5,
    'VIP Airport Transfer',
    'Private chauffeur-driven executive SUV transfer',
    12000,
    '2026-01-01 09:00:00',
    1,
  ],
  [
    6,
    'Heritage City Tour',
    'Guided excursion to cultural landmarks and temples',
    15000,
    '2026-01-01 09:00:00',
    1,
  ],
  [
    7,
    'Candlelight Dinner',
    'Beachfront / hilltop 4-course private dining setup',
    20000,
    '2026-01-01 09:00:00',
    1,
  ],
  [
    8,
    'Scuba & Water Sports',
    'Certified ocean diving excursion with gear included',
    18000,
    '2026-01-01 09:00:00',
    1,
  ],
];

const cancellationPolicies = [
  [1, 72, 'percentage', 0.0, 0.18, false], // > 72h: 100% Free cancellation
  [2, 24, 'first_night', 1.0, 0.18, false], // 24-71h: 1st night charged
  [3, 6, 'percentage', 0.5, 0.18, false], // 6-23h: 50% charged
  [4, 0, 'percentage', 1.0, 0.18, true], // < 6h / No-show: 100% charged + services
];

const guests = [
  [1, 'Amara', 'Perera', 'amara.perera@example.com', '+94771234567'],
  [2, 'Nimal', 'Fernando', 'nimal.fernando@example.com', '+94772345678'],
  [3, 'Kavya', 'Silva', 'kavya.silva@example.com', '+94773456789'],
  [4, 'Dilan', 'Jayawardena', 'dilan.j@example.com', '+94774567890'],
  [5, 'Maya', 'Wijesinghe', 'maya.w@example.com', '+94775678901'],
  [6, 'Oliver', 'Thompson', 'oliver.thompson@example.com', '+447700900123'],
  [7, 'Sophie', 'Chen', 'sophie.chen@example.com', '+61412345678'],
  [8, 'Lukas', 'Weber', 'lukas.weber@example.com', '+4915123456789'],
  [9, 'Yuki', 'Tanaka', 'yuki.tanaka@example.com', '+819012345678'],
  [10, 'Fatima', 'Al-Mansoor', 'fatima.m@example.com', '+971501234567'],
  [11, 'Jean', 'Dupont', 'jean.dupont@example.com', '+33612345678'],
  [12, 'Aarav', 'Patel', 'aarav.patel@example.com', '+919876543210'],
  [13, 'Elena', 'Rostova', 'elena.rostova@example.com', '+79161234567'],
  [14, 'Tariq', 'Hassan', 'tariq.h@example.com', '+94719876543'], // Edge case: 0 bookings
];

/**
 * 20 Distinct Bookings covering all operational and edge case combinations
 *
 * [
 *   booking_id, guest_id, booking_time, check_in_time, check_out_time, cancellation_time,
 *   booking_status, payment_status, total_charge, outstanding_amount, tax_id, tax_rate_at_booking,
 *   total_tax_amount, credit_amount, cancellation_fee, cancellation_tax_amount, cancellation_charge_services,
 *   cancellation_rule_id
 * ]
 */
const bookings = [
  // 1: Completed, Single room, Paid in full (Colombo Deluxe, Sep 01-04)
  [
    1,
    1,
    '2026-08-20 10:00:00',
    '2026-09-01 14:00:00',
    '2026-09-04 11:00:00',
    null,
    'Checked-Out',
    'Paid',
    0,
    0,
    1,
    0.18,
    0,
    0,
    0,
    0,
    false,
    null,
  ],

  // 2: Completed, Multi-room (Rooms 202 & 204), Paid via 2 installments (deposit + checkout)
  [
    2,
    2,
    '2026-08-25 12:00:00',
    '2026-09-10 14:00:00',
    '2026-09-14 11:00:00',
    null,
    'Checked-Out',
    'Paid',
    0,
    0,
    2,
    0.18,
    0,
    0,
    0,
    0,
    false,
    null,
  ],

  // 3: Ongoing Active stay (Galle Room 303, Oct 08-15), Partially Paid with outstanding dues
  [
    3,
    3,
    '2026-09-20 09:30:00',
    '2026-10-08 14:00:00',
    '2026-10-15 11:00:00',
    null,
    'Checked-In',
    'Partially Paid',
    0,
    0,
    3,
    0.18,
    0,
    0,
    0,
    0,
    false,
    null,
  ],

  // 4: Ongoing Active Multi-room stay (Colombo 104 & 105, Oct 10-16), Unpaid dues
  [
    4,
    12,
    '2026-09-28 15:00:00',
    '2026-10-10 14:00:00',
    '2026-10-16 11:00:00',
    null,
    'Checked-In',
    'Unpaid',
    0,
    0,
    1,
    0.18,
    0,
    0,
    0,
    0,
    false,
    null,
  ],

  // 5: Future reservation, Unpaid (Kandy Suite 205, Nov 01-05)
  [
    5,
    4,
    '2026-10-01 11:00:00',
    '2026-11-01 14:00:00',
    '2026-11-05 11:00:00',
    null,
    'Booked',
    'Unpaid',
    0,
    0,
    2,
    0.18,
    0,
    0,
    0,
    0,
    false,
    null,
  ],

  // 6: Future reservation, Partially Paid advance deposit (Galle Penthouse 308, Nov 10-20)
  [
    6,
    6,
    '2026-09-25 16:00:00',
    '2026-11-10 14:00:00',
    '2026-11-20 11:00:00',
    null,
    'Booked',
    'Partially Paid',
    0,
    0,
    3,
    0.18,
    0,
    0,
    0,
    0,
    false,
    null,
  ],

  // 7: Future reservation, Paid in full in advance (Galle Suite 306, Dec 01-07)
  [
    7,
    7,
    '2026-10-02 13:00:00',
    '2026-12-01 14:00:00',
    '2026-12-07 11:00:00',
    null,
    'Booked',
    'Paid',
    0,
    0,
    3,
    0.18,
    0,
    0,
    0,
    0,
    false,
    null,
  ],

  // 8: Cancelled > 72h advance (Rule 1: 0% fee, full refund)
  [
    8,
    5,
    '2026-09-15 10:00:00',
    '2026-11-15 14:00:00',
    '2026-11-18 11:00:00',
    '2026-10-01 10:00:00',
    'Cancelled',
    'Unpaid',
    0,
    0,
    1,
    0.18,
    0,
    0,
    0,
    0,
    false,
    1,
  ],

  // 9: Cancelled 24-71h notice (Rule 2: 1st night fee applied = 30000 + 5400 tax = 35400)
  [
    9,
    8,
    '2026-10-01 08:00:00',
    '2026-10-25 14:00:00',
    '2026-10-28 11:00:00',
    '2026-10-24 08:00:00',
    'Cancelled',
    'Paid',
    35400,
    0,
    3,
    0.18,
    5400,
    0,
    30000,
    5400,
    false,
    2,
  ],

  // 10: Cancelled late < 24h (Rule 3: 50% room fee + dispatched airport transfer service)
  [
    10,
    9,
    '2026-09-15 09:00:00',
    '2026-10-02 14:00:00',
    '2026-10-05 11:00:00',
    '2026-10-01 22:00:00',
    'Cancelled',
    'Paid',
    67260,
    0,
    2,
    0.18,
    10260,
    0,
    45000,
    8100,
    true,
    3,
  ],

  // 11: Overpaid Stay / Credit Due (Guest overpaid by 15,000 LKR)
  [
    11,
    10,
    '2026-09-01 14:00:00',
    '2026-09-20 14:00:00',
    '2026-09-23 11:00:00',
    null,
    'Checked-Out',
    'Credit Due',
    0,
    0,
    1,
    0.18,
    0,
    0,
    0,
    0,
    false,
    null,
  ],

  // 12: Minimum Stay (1 Night, Sep 28-29 Kandy Single Room 201)
  [
    12,
    11,
    '2026-09-25 18:00:00',
    '2026-09-28 14:00:00',
    '2026-09-29 11:00:00',
    null,
    'Checked-Out',
    'Paid',
    0,
    0,
    2,
    0.18,
    0,
    0,
    0,
    0,
    false,
    null,
  ],

  // 13: Extended Stay (14 Nights, Aug 10-24 Kandy Room 207)
  [
    13,
    6,
    '2026-07-20 11:00:00',
    '2026-08-10 14:00:00',
    '2026-08-24 11:00:00',
    null,
    'Checked-Out',
    'Paid',
    0,
    0,
    2,
    0.18,
    0,
    0,
    0,
    0,
    false,
    null,
  ],

  // 14: Same-day turnover Part A (Room 101, Sep 05 14:00 to Sep 08 11:00)
  [
    14,
    1,
    '2026-08-15 09:00:00',
    '2026-09-05 14:00:00',
    '2026-09-08 11:00:00',
    null,
    'Checked-Out',
    'Paid',
    0,
    0,
    1,
    0.18,
    0,
    0,
    0,
    0,
    false,
    null,
  ],

  // 15: Same-day turnover Part B (Room 101, Sep 08 14:00 to Sep 11 11:00)
  [
    15,
    8,
    '2026-08-28 14:00:00',
    '2026-09-08 14:00:00',
    '2026-09-11 11:00:00',
    null,
    'Checked-Out',
    'Paid',
    0,
    0,
    1,
    0.18,
    0,
    0,
    0,
    0,
    false,
    null,
  ],

  // 16: Zero Services Stay (Pure room charge only, Galle Room 301, Sep 18-20)
  [
    16,
    2,
    '2026-09-05 16:00:00',
    '2026-09-18 14:00:00',
    '2026-09-20 11:00:00',
    null,
    'Checked-Out',
    'Paid',
    0,
    0,
    3,
    0.18,
    0,
    0,
    0,
    0,
    false,
    null,
  ],

  // 17: Ongoing Active Stay with Pending Service Request (Galle Suite 307, Oct 11-14)
  [
    17,
    13,
    '2026-10-05 12:00:00',
    '2026-10-11 14:00:00',
    '2026-10-14 11:00:00',
    null,
    'Checked-In',
    'Partially Paid',
    0,
    0,
    3,
    0.18,
    0,
    0,
    0,
    0,
    false,
    null,
  ],

  // 18: Multiple Payment Methods (Cash + Card split payment, Colombo Room 102, Sep 22-25)
  [
    18,
    5,
    '2026-09-10 11:00:00',
    '2026-09-22 14:00:00',
    '2026-09-25 11:00:00',
    null,
    'Checked-Out',
    'Paid',
    0,
    0,
    1,
    0.18,
    0,
    0,
    0,
    0,
    false,
    null,
  ],

  // 19: High-Volume VIP Stay (5 distinct services consumed, Galle Penthouse 309, Sep 12-16)
  [
    19,
    10,
    '2026-08-15 15:00:00',
    '2026-09-12 14:00:00',
    '2026-09-16 11:00:00',
    null,
    'Checked-Out',
    'Paid',
    0,
    0,
    3,
    0.18,
    0,
    0,
    0,
    0,
    false,
    null,
  ],

  // 20: Peak Season Advance Reservation (Kandy Penthouse 206, Dec 28 to Jan 03)
  [
    20,
    3,
    '2026-10-08 19:00:00',
    '2026-12-28 14:00:00',
    '2027-01-03 11:00:00',
    null,
    'Booked',
    'Partially Paid',
    0,
    0,
    2,
    0.18,
    0,
    0,
    0,
    0,
    false,
    null,
  ],
];

const bookingRooms = [
  // 1: Room 103 (Deluxe 30,000 * 3 nights = 90,000)
  [1, 103, 30000, 90000],

  // 2: Multi-room: 202 (Double 22,000 * 4 = 88,000) + 204 (Family 42,000 * 4 = 168,000)
  [2, 202, 22000, 88000],
  [2, 204, 42000, 168000],

  // 3: Room 303 (Deluxe 30,000 * 7 nights = 210,000)
  [3, 303, 30000, 210000],

  // 4: Multi-room: 104 (Deluxe 30,000 * 6 = 180,000) + 105 (Family 42,000 * 6 = 252,000)
  [4, 104, 30000, 180000],
  [4, 105, 42000, 252000],

  // 5: Room 205 (Executive Suite 58,000 * 4 nights = 232,000)
  [5, 205, 58000, 232000],

  // 6: Room 308 (Penthouse 95,000 * 10 nights = 950,000)
  [6, 308, 95000, 950000],

  // 7: Room 306 (Executive Suite 58,000 * 6 nights = 348,000)
  [7, 306, 58000, 348000],

  // 8: Room 106 (Cancelled, 58,000 * 3 nights = 174,000)
  [8, 106, 58000, 174000],

  // 9: Room 304 (Cancelled, 30,000 * 3 nights = 90,000)
  [9, 304, 30000, 90000],

  // 10: Room 203 (Cancelled, 30,000 * 3 nights = 90,000)
  [10, 203, 30000, 90000],

  // 11: Room 107 (Penthouse 95,000 * 3 nights = 285,000)
  [11, 107, 95000, 285000],

  // 12: Room 201 (Single 15,000 * 1 night = 15,000)
  [12, 201, 15000, 15000],

  // 13: Room 207 (Double 22,000 * 14 nights = 308,000)
  [13, 207, 22000, 308000],

  // 14: Room 101 (Single 15,000 * 3 nights = 45,000)
  [14, 101, 15000, 45000],

  // 15: Room 101 (Single 15,000 * 3 nights = 45,000) - Back to back same day
  [15, 101, 15000, 45000],

  // 16: Room 301 (Single 15,000 * 2 nights = 30,000)
  [16, 301, 15000, 30000],

  // 17: Room 307 (Executive Suite 58,000 * 3 nights = 174,000)
  [17, 307, 58000, 174000],

  // 18: Room 102 (Double 22,000 * 3 nights = 66,000)
  [18, 102, 22000, 66000],

  // 19: Room 309 (Penthouse 95,000 * 4 nights = 380,000)
  [19, 309, 95000, 380000],

  // 20: Room 206 (Penthouse 95,000 * 6 nights = 570,000)
  [20, 206, 95000, 570000],
];

const serviceUsage = [
  // Booking 1: Gourmet Room service + Express laundry
  [1, 1, 1, 103, '2026-09-02 19:30:00', 2, 4500, 0.18, 'Completed'],
  [2, 1, 3, 103, '2026-09-03 10:00:00', 1, 3500, 0.18, 'Completed'],

  // Booking 2: Multi-room usage across different rooms
  [3, 2, 2, 202, '2026-09-11 16:00:00', 2, 14000, 0.18, 'Completed'], // Spa for room 202
  [4, 2, 4, 204, '2026-09-12 20:00:00', 3, 3000, 0.18, 'Completed'], // Minibar for room 204

  // Booking 3: Active stay services
  [5, 3, 2, 303, '2026-10-09 15:30:00', 1, 14000, 0.18, 'Completed'],
  [6, 3, 1, 303, '2026-10-10 08:30:00', 2, 4500, 0.18, 'Completed'],

  // Booking 4: Active multi-room stay
  [7, 4, 7, 104, '2026-10-11 19:30:00', 1, 20000, 0.18, 'Completed'],
  [8, 4, 3, 105, '2026-10-12 11:00:00', 2, 3500, 0.18, 'Completed'],

  // Booking 10: Cancelled late, airport transfer was dispatched and charged
  [9, 10, 5, 203, '2026-10-01 20:00:00', 1, 12000, 0.18, 'Completed'],

  // Booking 11: Overpaid stay VIP services
  [10, 11, 1, 107, '2026-09-21 13:00:00', 3, 4500, 0.18, 'Completed'],

  // Booking 12: 1-night stay room service
  [11, 12, 1, 201, '2026-09-28 20:00:00', 1, 4500, 0.18, 'Completed'],

  // Booking 13: Extended stay multiple laundry batches
  [12, 13, 3, 207, '2026-08-14 09:00:00', 2, 3500, 0.18, 'Completed'],
  [13, 13, 3, 207, '2026-08-18 09:00:00', 2, 3500, 0.18, 'Completed'],
  [14, 13, 5, 207, '2026-08-24 07:00:00', 1, 12000, 0.18, 'Completed'],

  // Booking 14 & 15: Turnover stays
  [15, 14, 4, 101, '2026-09-06 21:00:00', 2, 3000, 0.18, 'Completed'],
  [16, 15, 1, 101, '2026-09-09 08:30:00', 1, 4500, 0.18, 'Completed'],

  // Booking 17: Active stay with a PENDING service request
  [17, 17, 2, 307, '2026-10-12 14:00:00', 1, 14000, 0.18, 'Pending'],

  // Booking 18: Split payment stay
  [18, 18, 1, 102, '2026-09-23 09:00:00', 2, 4500, 0.18, 'Completed'],

  // Booking 19: High-volume VIP stay (5 distinct services)
  [19, 19, 1, 309, '2026-09-13 12:30:00', 4, 4500, 0.18, 'Completed'],
  [20, 19, 2, 309, '2026-09-13 17:00:00', 2, 14000, 0.18, 'Completed'],
  [21, 19, 4, 309, '2026-09-14 22:00:00', 4, 3000, 0.18, 'Completed'],
  [22, 19, 7, 309, '2026-09-15 19:30:00', 1, 20000, 0.18, 'Completed'],
  [23, 19, 8, 309, '2026-09-16 09:00:00', 2, 18000, 0.18, 'Completed'],
];

const payments = [
  // Booking 1: Full settlement (Room 90,000 + Services 12,500 = 102,500 + 18% tax 18,450 = 120,950)
  [1, 1, '2026-09-04 10:30:00', 'Card', 120950],

  // Booking 2: Multi-room split payment (Deposit 150,000 + Checkout balance)
  [2, 2, '2026-08-26 14:00:00', 'Bank Transfer', 150000],
  [3, 2, '2026-09-14 10:45:00', 'Card', 195740], // Settles total 345,740

  // Booking 3: Active stay deposit (Partial Payment)
  [4, 3, '2026-09-22 11:00:00', 'Card', 120000],

  // Booking 6: Advance deposit on long penthouse stay (Partial Payment)
  [5, 6, '2026-09-26 15:00:00', 'Bank Transfer', 500000],

  // Booking 7: Paid in full in advance (Room 348,000 + 18% tax = 410,640)
  [6, 7, '2026-10-02 14:00:00', 'Card', 410640],

  // Booking 9: Cancelled with 1st night fee settled (35,400 LKR)
  [7, 9, '2026-10-24 09:00:00', 'Card', 35400],

  // Booking 10: Cancelled late with fee + airport transfer settled (67,260 LKR)
  [8, 10, '2026-10-02 08:30:00', 'Card', 67260],

  // Booking 11: Overpayment edge case (Total bill 350,760; guest paid 370,000 -> Credit Due 19,240)
  [9, 11, '2026-09-23 10:00:00', 'Bank Transfer', 370000],

  // Booking 12: 1-night stay settled in Cash
  [10, 12, '2026-09-29 10:30:00', 'Cash', 23010],

  // Booking 13: Extended stay 3 installments
  [11, 13, '2026-07-22 10:00:00', 'Bank Transfer', 100000],
  [12, 13, '2026-08-10 15:00:00', 'Card', 150000],
  [13, 13, '2026-08-24 10:15:00', 'Card', 144120], // Settles total 394,120

  // Booking 14: Turnover A settled
  [14, 14, '2026-09-08 10:30:00', 'Card', 60180],

  // Booking 15: Turnover B settled
  [15, 15, '2026-09-11 10:30:00', 'Cash', 58410],

  // Booking 16: Zero services pure room charge settled
  [16, 16, '2026-09-20 10:45:00', 'Cash', 35400],

  // Booking 17: Active stay partial deposit
  [17, 17, '2026-10-06 14:00:00', 'Card', 100000],

  // Booking 18: Split payment (50% Cash + 50% Card)
  [18, 18, '2026-09-25 10:00:00', 'Cash', 44250],
  [19, 18, '2026-09-25 10:05:00', 'Card', 44250], // Settles total 88,500

  // Booking 19: High-volume VIP stay settled in full
  [20, 19, '2026-09-16 10:30:00', 'Card', 585280],

  // Booking 20: Advance 30% deposit on peak season stay
  [21, 20, '2026-10-09 11:00:00', 'Card', 200000],
];

/**
 * Helper to insert rows into a table.
 */
const insertRows = async (connection, table, columns, rows) => {
  const placeholders = columns.map(() => '?').join(', ');
  const sql = `INSERT INTO \`${table}\` (${columns.map((col) => `\`${col}\``).join(', ')}) VALUES (${placeholders})`;

  for (const row of rows) {
    await connection.execute(sql, row);
  }
};

/**
 * Recreates and populates the database with the comprehensive dataset.
 */
export async function seedComprehensiveDatabase() {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    console.log('Clearing existing records...');
    for (const table of [
      'notification_outbox',
      'cancellation_policy',
      'service_usage',
      'booking_room',
      'payment',
      'booking',
      'room_amenity',
      'service_catalogue',
      'room',
      'amenity',
      'room_type',
      'tax_rate',
      'branch',
      'guest',
    ]) {
      await connection.query(`DELETE FROM \`${table}\``);
    }

    console.log('Seeding branches and taxes...');
    await insertRows(connection, 'branch', ['branch_id', 'name', 'location_city'], branches);
    await insertRows(connection, 'tax_rate', ['tax_id', 'rate', 'branch_id'], taxRates);

    console.log('Seeding room types, amenities, and rooms...');
    await insertRows(
      connection,
      'room_type',
      [
        'room_type_id',
        'type_name',
        'room_type_description',
        'capacity',
        'daily_rate',
        'rate_update_time',
      ],
      roomTypes,
    );
    await insertRows(
      connection,
      'amenity',
      ['amenity_id', 'amenity_name', 'amenity_description'],
      amenities,
    );
    await insertRows(connection, 'room_amenity', ['amenity_id', 'room_type_id'], roomAmenities);
    await insertRows(
      connection,
      'room',
      [
        'room_id',
        'branch_id',
        'room_type_id',
        'room_number',
        'current_status',
        'booking_availability',
      ],
      rooms,
    );

    console.log('Seeding services and cancellation policies...');
    await insertRows(
      connection,
      'service_catalogue',
      [
        'service_id',
        'service_name',
        'service_description',
        'current_price',
        'price_update_time',
        'tax_id',
      ],
      services,
    );
    await insertRows(
      connection,
      'cancellation_policy',
      ['rule_id', 'minimum_notice_hours', 'fee_type', 'fee_value', 'tax_rate', 'charge_services'],
      cancellationPolicies,
    );

    console.log('Seeding guests and bookings...');
    await insertRows(
      connection,
      'guest',
      ['guest_id', 'first_name', 'last_name', 'email', 'phone_number'],
      guests,
    );
    await insertRows(
      connection,
      'booking',
      [
        'booking_id',
        'guest_id',
        'booking_time',
        'check_in_time',
        'check_out_time',
        'cancellation_time',
        'booking_status',
        'payment_status',
        'total_charge',
        'outstanding_amount',
        'tax_id',
        'tax_rate_at_booking',
        'total_tax_amount',
        'credit_amount',
        'cancellation_fee',
        'cancellation_tax_amount',
        'cancellation_charge_services',
        'cancellation_rule_id',
      ],
      bookings,
    );

    console.log('Seeding booking room assignments, services, and payments...');
    await insertRows(
      connection,
      'booking_room',
      ['booking_id', 'room_id', 'nightly_rate_at_booking', 'price_at_booking'],
      bookingRooms,
    );
    await insertRows(
      connection,
      'service_usage',
      [
        'usage_id',
        'booking_id',
        'service_id',
        'room_id',
        'usage_time',
        'quantity',
        'price_at_usage',
        'tax_rate_at_usage',
        'status',
      ],
      serviceUsage,
    );
    await insertRows(
      connection,
      'payment',
      ['payment_id', 'booking_id', 'payment_date', 'payment_method', 'amount'],
      payments,
    );

    console.log('Synchronizing billing calculations via sp_calculate_bill...');
    for (const [bookingId, , , , , , status] of bookings) {
      if (status !== 'Cancelled') {
        await connection.execute('CALL sp_calculate_bill(?)', [bookingId]);
      }
    }

    await connection.commit();
    console.log('✓ Comprehensive extended dataset successfully seeded!');
    console.log(
      'Run "npm run auth:seed" to provision Better Auth login credentials for all 14 guests.',
    );
  } catch (error) {
    await connection.rollback();
    console.error('Seeding transaction failed:', error.message);
    throw error;
  } finally {
    connection.release();
    await pool.end();
  }
}

seedComprehensiveDatabase().catch((error) => {
  console.error('Fatal seeding error:', error);
  process.exitCode = 1;
});
