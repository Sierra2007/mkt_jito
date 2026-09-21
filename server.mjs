import http from 'node:http';
import crypto from 'node:crypto';

const PORT = Number(process.env.PORT || 8080);

const ADMIN_URL =
  process.env.ADMIN_URL ||
  'https://admin-inr911-htvlau.c-e-g-l.com';

const API_BASE =
  process.env.API_BASE ||
  'https://admin.y-f-r-h.com';

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const TOTP_SECRET = process.env.TOTP_SECRET || '';

const X_SITE = process.env.X_SITE || 'inr911';
const X_LANGUAGE = process.env.X_LANGUAGE || 'zh-CN';
const API_KEY = process.env.API_KEY || '';

let cachedToken = null;
let cachedTokenExpiresAt = 0;
let loginPromise = null;

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(data));
}

function checkApiKey(req) {
  if (!API_KEY) return true;
  return req.headers['x-api-key'] === API_KEY;
}

function base32Decode(input) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = String(input)
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/=+$/g, '');

  let bits = '';

  for (const char of clean) {
    const value = alphabet.indexOf(char);
    if (value === -1) {
      throw new Error(`TOTP_SECRET 含有無效字元: ${char}`);
    }
    bits += value.toString(2).padStart(5, '0');
  }

  const bytes = [];

  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }

  return Buffer.from(bytes);
}

function generateTotp(secret, timestamp = Date.now()) {
  if (!secret) {
    throw new Error('Zeabur 環境變數尚未設定 TOTP_SECRET');
  }

  const key = base32Decode(secret);
  const counter = Math.floor(timestamp / 1000 / 30);

  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));

  const hmac = crypto
    .createHmac('sha1', key)
    .update(buffer)
    .digest();

  const offset = hmac[hmac.length - 1] & 0x0f;

  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return String(code % 1000000).padStart(6, '0');
}

async function login() {
  if (!ADMIN_USERNAME) {
    throw new Error('Zeabur 環境變數尚未設定 ADMIN_USERNAME');
  }

  if (!ADMIN_PASSWORD) {
    throw new Error('Zeabur 環境變數尚未設定 ADMIN_PASSWORD');
  }

  if (!TOTP_SECRET) {
    throw new Error('Zeabur 環境變數尚未設定 TOTP_SECRET');
  }

  const otp = generateTotp(TOTP_SECRET);

  const response = await fetch(`${API_BASE}/api/login`, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/plain, */*',
      'accept-language': 'zh-CN,zh;q=0.9,zh-TW;q=0.8,en;q=0.7',
      authorization: 'Bearer',
      'content-type': 'application/json',
      origin: ADMIN_URL,
      referer: `${ADMIN_URL}/`,
      'user-agent':
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/151 Safari/537.36',
      'x-language': X_LANGUAGE,
      'x-site': X_SITE,
    },
    body: JSON.stringify({
      identity: ADMIN_USERNAME,
      password: ADMIN_PASSWORD,
      otp,
    }),
    signal: AbortSignal.timeout(20000),
  });

  const text = await response.text();

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(
      `登入 API 回傳非 JSON，HTTP ${response.status}: ${text.slice(0, 500)}`
    );
  }

  if (!response.ok) {
    throw new Error(
      `登入失敗，HTTP ${response.status}: ${JSON.stringify(json)}`
    );
  }

  const token = json?.data?.token;
  const expiresAtRaw = json?.data?.expires_at;

  if (!token) {
    throw new Error(
      `登入成功但 Response 找不到 data.token: ${JSON.stringify(json)}`
    );
  }

  const expiresAt = expiresAtRaw
    ? new Date(expiresAtRaw).getTime()
    : Date.now() + 60 * 60 * 1000;

  cachedToken = token;
  cachedTokenExpiresAt = expiresAt - 60 * 1000;

  console.log(
    `[auth] login success, expires_at=${expiresAtRaw || 'unknown'}`
  );

  return cachedToken;
}

async function getValidToken(forceRefresh = false) {
  if (
    !forceRefresh &&
    cachedToken &&
    Date.now() < cachedTokenExpiresAt
  ) {
    return cachedToken;
  }

  if (loginPromise) {
    return loginPromise;
  }

  loginPromise = login();

  try {
    return await loginPromise;
  } finally {
    loginPromise = null;
  }
}

function clearToken() {
  cachedToken = null;
  cachedTokenExpiresAt = 0;
}

function buildHeaders(token) {
  return {
    accept: 'application/json, text/plain, */*',
    'accept-language': 'zh-CN,zh;q=0.9',
    authorization: `Bearer ${token}`,
    origin: ADMIN_URL,
    referer: `${ADMIN_URL}/`,
    'user-agent':
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/151 Safari/537.36',
    'x-language': X_LANGUAGE,
    'x-site': X_SITE,
  };
}

function getIndiaToday() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const map = {};

  for (const part of parts) {
    map[part.type] = part.value;
  }

  return `${map.year}-${map.month}-${map.day}`;
}

function validateDate(date) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date);
}

function getIndiaDateRange(dateString) {
  const date = dateString || getIndiaToday();

  if (!validateDate(date)) {
    throw new Error('date 格式錯誤，請使用 YYYY-MM-DD');
  }

  const start = new Date(`${date}T00:00:00+05:30`);
  const end = new Date(`${date}T23:59:59+05:30`);

  return {
    date,
    timezone: 'Asia/Kolkata',
    start_time: Math.floor(start.getTime() / 1000),
    end_time: Math.floor(end.getTime() / 1000),
  };
}

function resolveDateRange(url) {
  const manualStart = url.searchParams.get('start_time');
  const manualEnd = url.searchParams.get('end_time');

  if (manualStart && manualEnd) {
    return {
      date: null,
      timezone: 'manual',
      start_time: Number(manualStart),
      end_time: Number(manualEnd),
    };
  }

  return getIndiaDateRange(url.searchParams.get('date'));
}

async function authenticatedFetch(url, options = {}) {
  async function execute(forceRefresh = false) {
    const token = await getValidToken(forceRefresh);

    return fetch(url, {
      ...options,
      headers: {
        ...buildHeaders(token),
        ...(options.headers || {}),
      },
      signal: AbortSignal.timeout(30000),
    });
  }

  let response = await execute(false);

  if (response.status === 401 || response.status === 403) {
    clearToken();
    response = await execute(true);
  }

  return response;
}

async function parseUpstreamResponse(response, name) {
  const text = await response.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    const error = new Error(
      `${name} API 回傳 HTTP ${response.status}`
    );
    error.statusCode = response.status;
    error.upstream = data;
    throw error;
  }

  return data;
}

// =====================================================
// 自動抓取所有分頁
// API 目前資料陣列位置：response.data.data
// =====================================================
async function fetchAllPages({
  pathname,
  range,
  extraParams = {},
  name,
}) {
  const PAGE_SIZE = 100;
  const MAX_PAGES = 100;

  let page = 1;
  let allRows = [];
  let firstResponse = null;

  while (page <= MAX_PAGES) {
    const url = new URL(`${API_BASE}${pathname}`);

    url.searchParams.set('sorts[id]', 'desc');
    url.searchParams.set(
      'start_time',
      String(range.start_time)
    );
    url.searchParams.set(
      'end_time',
      String(range.end_time)
    );

    for (const [key, value] of Object.entries(extraParams)) {
      url.searchParams.set(key, String(value));
    }

    url.searchParams.set('current_page', String(page));
    url.searchParams.set('page_size', String(PAGE_SIZE));

    const response = await authenticatedFetch(url);
    const json = await parseUpstreamResponse(
      response,
      `${name} page ${page}`
    );

    if (!firstResponse) {
      firstResponse = json;
    }

    const rows = Array.isArray(json?.data?.data)
      ? json.data.data
      : [];

    allRows.push(...rows);

    console.log(
      `[${name}] page=${page}, rows=${rows.length}, total=${allRows.length}`
    );

    if (rows.length < PAGE_SIZE) {
      break;
    }

    page += 1;
  }

  if (!firstResponse) {
    firstResponse = {
      data: {
        data: [],
      },
    };
  }

  if (!firstResponse.data) {
    firstResponse.data = {};
  }

  firstResponse.data.data = allRows;

  // 額外提供實際抓到的筆數，方便 n8n 檢查
  firstResponse.data.fetched_count = allRows.length;

  return firstResponse;
}

async function getPromotionChannel(range) {
  return fetchAllPages({
    pathname:
      '/api/ad/report/promotionchannelstat',
    range,
    extraParams: {},
    name: 'promotion-channel',
  });
}

async function getMemberLifecycle(range) {
  return fetchAllPages({
    pathname:
      '/api/report/member-lifecycle',
    range,
    extraParams: {
      view: 'channel',
      actor_type: 'all',
    },
    name: 'member-lifecycle',
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(
      req.url,
      `http://${req.headers.host || 'localhost'}`
    );

    if (url.pathname === '/health') {
      if (req.method !== 'GET') {
        return sendJson(res, 405, {
          ok: false,
          error: 'Method Not Allowed',
        });
      }

      return sendJson(res, 200, {
        ok: true,
        service: 'zeabur-report-api',
        timezone: 'Asia/Kolkata',
        india_today: getIndiaToday(),
        auth: {
          username_configured: Boolean(ADMIN_USERNAME),
          password_configured: Boolean(ADMIN_PASSWORD),
          totp_configured: Boolean(TOTP_SECRET),
          token_cached:
            Boolean(cachedToken) &&
            Date.now() < cachedTokenExpiresAt,
        },
        endpoints: [
          '/promotion-channel',
          '/member-lifecycle',
          '/all',
          '/auth-test',
        ],
      });
    }

    if (req.method !== 'GET') {
      return sendJson(res, 405, {
        ok: false,
        error: 'Method Not Allowed',
      });
    }

    if (!checkApiKey(req)) {
      return sendJson(res, 401, {
        ok: false,
        error: 'Invalid API key',
      });
    }

    if (url.pathname === '/auth-test') {
      const token = await getValidToken(true);

      return sendJson(res, 200, {
        ok: true,
        message: '後台登入成功並取得 Token',
        token_received: Boolean(token),
        token_expires_at: cachedTokenExpiresAt
          ? new Date(
              cachedTokenExpiresAt + 60 * 1000
            ).toISOString()
          : null,
      });
    }

    const range = resolveDateRange(url);

    if (url.pathname === '/promotion-channel') {
      const data = await getPromotionChannel(range);

      return sendJson(res, 200, {
        ok: true,
        query: range,
        promotion_channel: data,
      });
    }

    if (url.pathname === '/member-lifecycle') {
      const data = await getMemberLifecycle(range);

      return sendJson(res, 200, {
        ok: true,
        query: range,
        member_lifecycle: data,
      });
    }

    if (url.pathname === '/all') {
      const [
        promotionChannel,
        memberLifecycle,
      ] = await Promise.all([
        getPromotionChannel(range),
        getMemberLifecycle(range),
      ]);

      return sendJson(res, 200, {
        ok: true,
        query: range,
        promotion_channel: promotionChannel,
        member_lifecycle: memberLifecycle,
      });
    }

    return sendJson(res, 404, {
      ok: false,
      error: 'Not Found',
    });
  } catch (error) {
    console.error(error);

    return sendJson(
      res,
      error.statusCode || 500,
      {
        ok: false,
        error:
          error.message ||
          'Internal Server Error',
        upstream:
          error.upstream ||
          undefined,
      }
    );
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(
    `zeabur-report-api listening on http://0.0.0.0:${PORT}`
  );
});
