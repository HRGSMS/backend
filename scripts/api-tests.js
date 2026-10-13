import 'dotenv/config';

const baseUrl = (process.env.API_URL || 'http://localhost:4000').replace(/\/$/, '');
const logLevelNames = ['quiet', 'normal', 'verbose', 'debug'];
const cliLogLevel = process.argv.includes('--debug')
  ? 'debug'
  : process.argv.includes('--verbose')
    ? 'verbose'
    : process.argv.includes('--quiet')
      ? 'quiet'
      : null;
const logLevel = cliLogLevel || process.env.API_TEST_LOG_LEVEL || 'normal';
const logLevelIndex = logLevelNames.indexOf(logLevel);

if (logLevelIndex < 0) {
  console.error(`Invalid API_TEST_LOG_LEVEL "${logLevel}". Use quiet, normal, verbose, or debug.`);
  process.exitCode = 1;
}

const credentials = {
  admin: ['admin@hotel.com', 'admin123'],
  manager: ['manager@hotel.com', 'manager123'],
  frontDesk: ['frontdesk@hotel.com', 'frontdesk123'],
  guest: ['amara.perera@example.com', 'guest123'],
};

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
  magenta: '\x1b[35m',
};

let passed = 0;
let failed = 0;

function shouldLog(level) {
  return logLevelIndex >= logLevelNames.indexOf(level);
}

function formatBody(value) {
  if (value === undefined || value === null || value === '') return '(empty)';

  const redacted = JSON.parse(
    JSON.stringify(value, (key, nestedValue) => {
      if (/password|token|cookie|secret/i.test(key)) return '[redacted]';
      return nestedValue;
    }),
  );
  const text = typeof redacted === 'string' ? redacted : JSON.stringify(redacted, null, 2);
  return text.length > 4000 ? `${text.slice(0, 4000)}\n... (truncated)` : text;
}

function printTraceRequest(method, path, body, headers) {
  if (!shouldLog('verbose')) return;

  const visibleHeaders = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key,
      /cookie|authorization/i.test(key) ? '[redacted]' : value,
    ]),
  );
  console.log(
    `${colors.magenta}→ ${method} ${path}${colors.reset}\n` +
      `${colors.gray}Request headers:${colors.reset} ${formatBody(visibleHeaders)}\n` +
      `${colors.gray}Request body:${colors.reset} ${formatBody(body)}`,
  );
}

function printTraceResponse(method, path, response, data, durationMs) {
  if (!shouldLog('verbose')) return;

  const statusColor = response.ok ? colors.green : colors.red;
  console.log(
    `${statusColor}← ${method} ${path} ${response.status} ${response.statusText} ` +
      `(${durationMs} ms)${colors.reset}\n` +
      `${colors.gray}Response headers:${colors.reset} ${formatBody(
        Object.fromEntries(response.headers.entries()),
      )}\n` +
      `${colors.gray}Response body:${colors.reset} ${formatBody(data)}`,
  );
}

function printHeader(title) {
  if (logLevel === 'quiet') return;
  console.log(`\n${colors.cyan}━━━ ${title} ━━━${colors.reset}`);
}

function printResult(ok, method, path, status, detail = '') {
  if (logLevel === 'quiet') return;
  const icon = ok ? '✓' : '✗';
  const color = ok ? colors.green : colors.red;
  console.log(
    `${color}${icon}${colors.reset} ${method.padEnd(6)} ${path.padEnd(55)} ${String(status).padEnd(4)} ${detail}`,
  );
}

function assertNoDatabaseIds(value, path = 'response') {
  if (!value || typeof value !== 'object') return;

  for (const [key, nestedValue] of Object.entries(value)) {
    if (
      key !== 'public_id' &&
      !key.endsWith('_public_id') &&
      (key === 'id' || key === 'ids' || key.endsWith('_id'))
    ) {
      throw new Error(`database identifier "${path}.${key}" was exposed`);
    }
    assertNoDatabaseIds(nestedValue, `${path}.${key}`);
  }
}

function getCookie(headers) {
  const setCookies = headers.getSetCookie?.() || [];
  return setCookies.map((cookie) => cookie.split(';', 1)[0]).join('; ');
}

async function request(method, path, body, cookie = '') {
  const headers = {
    origin: baseUrl,
  };

  if (body !== undefined) {
    headers['content-type'] = 'application/json';
  }
  if (cookie) {
    headers.cookie = cookie;
  }

  printTraceRequest(method, path, body, headers);
  const startedAt = Date.now();
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  printTraceResponse(method, path, response, data, Date.now() - startedAt);

  return {
    response,
    data,
    cookie: getCookie(response.headers),
  };
}

function printSummary() {
  console.log(
    `\n${colors.cyan}Summary${colors.reset}: ${colors.green}${passed} passed${colors.reset}, ${
      failed ? colors.red : colors.green
    }${failed} failed${colors.reset}`,
  );
}

async function test(label, method, path, options = {}) {
  try {
    const result = await request(method, path, options.body, options.cookie);
    const expected = options.status ?? 200;
    const ok = result.response.status === expected;

    if (!ok) {
      throw new Error(`expected ${expected}, received ${result.response.status}`);
    }
    if (options.collection && (!Array.isArray(result.data?.data) || !('data' in result.data))) {
      throw new Error('expected a { data: [] } response');
    }
    if (options.hideIds) {
      assertNoDatabaseIds(result.data);
    }

    passed += 1;
    printResult(true, method, path, result.response.status, label);
    return result;
  } catch (error) {
    failed += 1;
    const status = error.cause?.status || 'ERR';
    const detail =
      error.message === 'fetch failed' ? 'server unavailable' : `${label}: ${error.message}`;
    printResult(false, method, path, status, detail);
    if (shouldLog('debug')) {
      console.error(`${colors.gray}${error.stack || error}${colors.reset}`);
    }
    return null;
  }
}

async function signIn(label, email, password) {
  const result = await test(label, 'POST', '/api/auth/sign-in/email', {
    body: { email, password, rememberMe: true },
    status: 200,
  });

  if (!result?.cookie) {
    throw new Error(`${label} did not receive a session cookie`);
  }

  return result.cookie;
}

async function runTests() {
  if (logLevelIndex < 0) return;

  if (logLevel !== 'quiet') {
    console.log(`${colors.cyan}HRGSMS API test runner${colors.reset}`);
    console.log(
      `${colors.gray}Target: ${baseUrl} | Log level: ${logLevel} ` +
        '(use --verbose or --debug for request/response details)' +
        `${colors.reset}`,
    );
  }

  printHeader('Public and authentication endpoints');
  await test('health check', 'GET', '/api/health');
  await test('view rooms without session', 'GET', '/api/rooms', {
    collection: true,
    hideIds: true,
  });
  await test(
    'view room availability without session',
    'GET',
    '/api/rooms?available_from=2026-10-20&available_to=2026-10-23',
    {
      collection: true,
      hideIds: true,
    },
  );
  await test('protected route without session', 'GET', '/api/branches', { status: 401 });
  await test('public sign-up disabled', 'POST', '/api/auth/sign-up/email', {
    body: {
      name: 'Unauthorised User',
      email: `blocked-${Date.now()}@example.com`,
      password: 'not-created',
    },
    status: 400,
  });

  const adminCookie = await signIn('admin sign-in', ...credentials.admin);
  const managerCookie = await signIn('manager sign-in', ...credentials.manager);
  const frontDeskCookie = await signIn('front-desk sign-in', ...credentials.frontDesk);
  const guestCookie = await signIn('guest sign-in', ...credentials.guest);

  await test('admin session', 'GET', '/api/auth/get-session', { cookie: adminCookie });
  await test('manager session', 'GET', '/api/auth/get-session', { cookie: managerCookie });
  await test('front-desk session', 'GET', '/api/auth/get-session', { cookie: frontDeskCookie });
  await test('guest session', 'GET', '/api/auth/get-session', { cookie: guestCookie });
  await test('guest profile', 'GET', '/api/guest/profile', { cookie: guestCookie });
  await test('guest bookings', 'GET', '/api/guest/bookings', {
    cookie: guestCookie,
    collection: true,
    hideIds: true,
  });

  printHeader('Admin-only authentication endpoints');
  await test('admin lists users', 'GET', '/api/auth/admin/list-users?limit=100', {
    cookie: adminCookie,
  });
  await test('manager cannot list users', 'GET', '/api/auth/admin/list-users?limit=100', {
    cookie: managerCookie,
    status: 403,
  });

  const testEmail = `api-test-${Date.now()}@example.com`;
  const created = await test('admin creates user', 'POST', '/api/auth/admin/create-user', {
    cookie: adminCookie,
    body: {
      name: 'API Test User',
      email: testEmail,
      password: 'api-test-password',
      role: 'front_desk',
    },
  });
  const createdUserId = created?.data?.user?.id;

  await test('manager cannot create user', 'POST', '/api/auth/admin/create-user', {
    cookie: managerCookie,
    body: {
      name: 'Rejected User',
      email: `rejected-${Date.now()}@example.com`,
      password: 'rejected-password',
      role: 'front_desk',
    },
    status: 403,
  });

  if (createdUserId) {
    await test('admin changes user role', 'POST', '/api/auth/admin/set-role', {
      cookie: adminCookie,
      body: { userId: createdUserId, role: 'manager' },
    });
    await test('admin removes test user', 'POST', '/api/auth/admin/remove-user', {
      cookie: adminCookie,
      body: { userId: createdUserId },
    });
  }

  printHeader('Reference and operational data endpoints');
  const protectedEndpoints = [
    ['/api/branches', 'branches'],
    ['/api/branches?limit=2&offset=0', 'branch pagination'],
    ['/api/room-types', 'room types'],
    ['/api/amenities', 'amenities'],
    ['/api/services', 'services'],
    ['/api/guests', 'guests'],
    ['/api/rooms', 'rooms'],
    ['/api/rooms?available_from=2026-10-20&available_to=2026-10-23', 'room availability'],
    ['/api/bookings', 'bookings'],
    ['/api/bookings?status=Checked-In', 'booking status filter'],
  ];

  for (const [path, label] of protectedEndpoints) {
    await test(label, 'GET', path, {
      cookie: frontDeskCookie,
      collection: true,
      hideIds: true,
    });
  }

  await test('identifier query rejected', 'GET', '/api/rooms?branch_id=1', {
    cookie: frontDeskCookie,
    status: 400,
  });
  await test(
    'invalid availability date rejected',
    'GET',
    '/api/rooms?available_from=invalid&available_to=2026-10-23',
    {
      cookie: frontDeskCookie,
      status: 400,
    },
  );

  printHeader('Create, update, and delete APIs');
  const guests = await request('GET', '/api/guests', undefined, adminCookie);
  const rooms = await request('GET', '/api/rooms', undefined, adminCookie);
  const services = await request('GET', '/api/services', undefined, adminCookie);
  const guestPublicId = guests.data?.data?.[0]?.public_id;
  const roomPublicId = rooms.data?.data?.[0]?.public_id;
  const servicePublicId = services.data?.data?.[0]?.public_id;
  if (!guestPublicId || !roomPublicId || !servicePublicId) {
    throw new Error('Seeded public UUIDs are required for write API tests');
  }
  const testGuestEmail = `w${Date.now()}@e.co`;
  await test('admin creates guest', 'POST', '/api/guests', {
    cookie: adminCookie,
    status: 201,
    body: {
      first_name: 'API',
      last_name: 'Test',
      email: testGuestEmail,
      phone_number: '+94770000000',
    },
  });
  const createdGuest = await request('GET', `/api/guests`, undefined, adminCookie);
  const createdGuestPublicId = createdGuest.data?.data?.find(
    (guest) => guest.email === testGuestEmail,
  )?.public_id;
  await test('admin updates guest', 'PATCH', `/api/guests/${createdGuestPublicId}`, {
    cookie: adminCookie,
    body: { phone_number: '+94771111111' },
  });
  await test('admin deletes guest', 'DELETE', `/api/guests/${createdGuestPublicId}`, {
    cookie: adminCookie,
    status: 204,
  });

  const testServiceName = `Test${Date.now()}`.slice(0, 20);
  const createdService = await test('manager creates service', 'POST', '/api/services', {
    cookie: managerCookie,
    status: 201,
    body: {
      service_name: testServiceName,
      service_description: 'Temporary API test service',
      current_price: 10,
    },
  });
  const createdServicePublicId = createdService?.data?.data?.public_id;
  await test('manager updates service', 'PATCH', `/api/services/${createdServicePublicId}`, {
    cookie: managerCookie,
    body: { current_price: 12 },
  });
  await test('manager deletes service', 'DELETE', `/api/services/${createdServicePublicId}`, {
    cookie: managerCookie,
    status: 204,
  });

  const createdBooking = await test('front-desk creates booking', 'POST', '/api/bookings', {
    cookie: frontDeskCookie,
    status: 201,
    body: {
      guest_public_id: guestPublicId,
      room_public_ids: [roomPublicId],
      check_in_time: '2030-01-10T14:00:00',
      check_out_time: '2030-01-12T11:00:00',
    },
  });
  const createdBookingPublicId = createdBooking?.data?.data?.public_id;
  await test('front-desk updates booking', 'PATCH', `/api/bookings/${createdBookingPublicId}`, {
    cookie: frontDeskCookie,
    body: { check_out_time: '2030-01-13T11:00:00' },
  });
  await test('manager deletes booking', 'DELETE', `/api/bookings/${createdBookingPublicId}`, {
    cookie: managerCookie,
    status: 204,
  });

  printHeader('Guest service request APIs');
  const serviceOptions = await test(
    'service request options',
    'GET',
    '/api/service-request-options',
    {
      cookie: frontDeskCookie,
      collection: true,
      hideIds: true,
    },
  );
  const serviceOption = serviceOptions?.data?.data?.[0];
  if (serviceOption) {
    const createdRequest = await test(
      'front-desk creates service request',
      'POST',
      `/api/bookings/${serviceOption.booking_public_id}/services`,
      {
        cookie: frontDeskCookie,
        status: 201,
        body: {
          service_public_id: servicePublicId,
          room_public_id: serviceOption.room_public_id,
          quantity: 1,
        },
      },
    );
    const requestPublicId = createdRequest?.data?.data?.public_id;
    await test('staff lists service requests', 'GET', '/api/service-requests?status=Pending', {
      cookie: managerCookie,
      collection: true,
      hideIds: true,
    });
    await test(
      'manager completes service request',
      'PATCH',
      `/api/service-requests/${requestPublicId}/complete`,
      {
        cookie: managerCookie,
        hideIds: true,
      },
    );
  }

  printHeader('Report endpoints');
  const reportEndpoints = [
    ['/api/reports/occupancy?from=2026-10-01&to=2026-10-31', 'occupancy report'],
    ['/api/reports/billing', 'billing report'],
    ['/api/reports/service-usage', 'service usage report'],
    ['/api/reports/service-usage?from=2026-10-01&to=2026-11-01', 'filtered service usage report'],
    ['/api/reports/revenue?from=2026-10-01&to=2026-11-01', 'revenue report'],
    ['/api/reports/top-services', 'top services report'],
  ];

  for (const [path, label] of reportEndpoints) {
    await test(label, 'GET', path, {
      cookie: managerCookie,
      collection: true,
      hideIds: true,
    });
  }

  printHeader('Sign out');
  await test('admin sign-out', 'POST', '/api/auth/sign-out', {
    cookie: adminCookie,
  });
  await test('manager sign-out', 'POST', '/api/auth/sign-out', {
    cookie: managerCookie,
  });
  await test('front-desk sign-out', 'POST', '/api/auth/sign-out', {
    cookie: frontDeskCookie,
  });

  printSummary();

  if (failed > 0) {
    process.exitCode = 1;
  }
}

runTests().catch((error) => {
  console.error(`\n${colors.red}Test runner failed:${colors.reset}`, error);
  printSummary();
  process.exitCode = 1;
});
