import http from 'node:http';
import { URL } from 'node:url';

const PORT = Number(process.env.PORT || 8080);
const HOST = '0.0.0.0';

const API_BASE = process.env.API_BASE || 'https://admin.y-f-r-h.com';
const ORIGIN = process.env.ADMIN_ORIGIN || 'https://admin-inr911-htvlau.c-e-g-l.com';
const SITE = process.env.X_SITE || 'inr911';
const LANGUAGE = process.env.X_LANGUAGE || 'zh-CN';
const BEARER_TOKEN = process.env.BEARER_TOKEN || '';
const API_KEY = process.env.API_KEY || '';

function json(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

function requireApiKey(req, res) {
  if (!API_KEY) return true;
  const key = req.headers['x-api-key'];
  if (key !== API_KEY) {
    json(res, 401, { ok: false, error: 'Unauthorized' });
    return false;
  }
  return true;
}

function getAuthToken() {
  if (!BEARER_TOKEN) {
    throw new Error('Missing BEARER_TOKEN environment variable');
  }
  return BEARER_TOKEN.startsWith('Bearer ')
    ? BEARER_TOKEN
    : `Bearer ${BEARER_TOKEN}`;
}

function buildHeaders() {
  return {
    accept: 'application/json, text/plain, */*',
    'accept-language': 'zh-CN,zh;q=0.9',
    authorization: getAuthToken(),
    origin: ORIGIN,
    referer: `${ORIGIN}/`,
    'user-agent': 'Mozilla/5.0 (compatible; ZeaburReportBot/1.0)',
    'x-language': LANGUAGE,
    'x-site': SITE,
  };
}

function copyQueryParams(inputUrl, targetUrl, allowed) {
  for (const key of allowed) {
    const value = inputUrl.searchParams.get(key);
    if (value !== null && value !== '') {
      targetUrl.searchParams.set(key, value);
    }
  }
}

function applyDefaults(targetUrl, defaults) {
  for (const [key, value] of Object.entries(defaults)) {
    if (!targetUrl.searchParams.has(key) && value !== undefined && value !== null) {
      targetUrl.searchParams.set(key, String(value));
    }
  }
}

async function fetchJson(url) {
  const response = await fetch(url, {
    method: 'GET',
    headers: buildHeaders(),
    signal: AbortSignal.timeout(30000),
  });

  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    const err = new Error(`Upstream API ${response.status}`);
    err.status = response.status;
    err.data = data;
    throw err;
  }

  return data;
}

function requireTimeRange(inputUrl, res) {
  const startTime = inputUrl.searchParams.get('start_time');
  const endTime = inputUrl.searchParams.get('end_time');

  if (!startTime || !endTime) {
    json(res, 400, {
      ok: false,
      error: 'start_time and end_time are required',
      example: '/all?start_time=1789929000&end_time=1790015399',
    });
    return false;
  }
  return true;
}

async function getPromotionChannel(inputUrl) {
  const target = new URL('/api/ad/report/promotionchannelstat', API_BASE);

  copyQueryParams(inputUrl, target, [
    'start_time',
    'end_time',
    'current_page',
    'page_size',
  ]);

  applyDefaults(target, {
    'sorts[id]': 'desc',
    current_page: 1,
    page_size: 1000,
  });

  return {
    name: 'promotion_channel_stat',
    source: target.toString(),
    data: await fetchJson(target),
  };
}

async function getMemberLifecycle(inputUrl) {
  // 你貼的第二段 curl 重複成 promotionchannelstat。
  // 會員生命週期依你先前使用的後台路徑，使用 /api/report/member-lifecycle。
  const target = new URL('/api/report/member-lifecycle', API_BASE);

  copyQueryParams(inputUrl, target, [
    'start_time',
    'end_time',
    'view',
    'actor_type',
    'current_page',
    'page_size',
  ]);

  applyDefaults(target, {
    'sorts[id]': 'desc',
    view: 'channel',
    actor_type: 'all',
    current_page: 1,
    page_size: 1000,
  });

  return {
    name: 'member_lifecycle',
    source: target.toString(),
    data: await fetchJson(target),
  };
}

const server = http.createServer(async (req, res) => {
  try {
    if (!requireApiKey(req, res)) return;

    const inputUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (req.method !== 'GET') {
      return json(res, 405, { ok: false, error: 'Method not allowed' });
    }

    if (inputUrl.pathname === '/' || inputUrl.pathname === '/health') {
      return json(res, 200, {
        ok: true,
        service: 'zeabur-report-api',
        endpoints: [
          '/promotion-channel?start_time=...&end_time=...',
          '/member-lifecycle?start_time=...&end_time=...',
          '/all?start_time=...&end_time=...',
        ],
      });
    }

    if (!requireTimeRange(inputUrl, res)) return;

    if (inputUrl.pathname === '/promotion-channel') {
      const result = await getPromotionChannel(inputUrl);
      return json(res, 200, { ok: true, ...result });
    }

    if (inputUrl.pathname === '/member-lifecycle') {
      const result = await getMemberLifecycle(inputUrl);
      return json(res, 200, { ok: true, ...result });
    }

    if (inputUrl.pathname === '/all') {
      const [promotion, lifecycle] = await Promise.all([
        getPromotionChannel(inputUrl),
        getMemberLifecycle(inputUrl),
      ]);

      return json(res, 200, {
        ok: true,
        query: {
          start_time: inputUrl.searchParams.get('start_time'),
          end_time: inputUrl.searchParams.get('end_time'),
        },
        promotion_channel: promotion.data,
        member_lifecycle: lifecycle.data,
      });
    }

    return json(res, 404, { ok: false, error: 'Not found' });
  } catch (error) {
    console.error(error);
    return json(res, error.status || 500, {
      ok: false,
      error: error.message || 'Internal server error',
      upstream: error.data || undefined,
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`zeabur-report-api listening on http://${HOST}:${PORT}`);
});
