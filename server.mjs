import http from 'node:http';

const PORT = Number(process.env.PORT || 8080);
const API_BASE = process.env.API_BASE || 'https://admin.y-f-r-h.com';
const ADMIN_ORIGIN = process.env.ADMIN_ORIGIN || 'https://admin-inr911-htvlau.c-e-g-l.com';
const X_SITE = process.env.X_SITE || 'inr911';
const X_LANGUAGE = process.env.X_LANGUAGE || 'zh-CN';
const BEARER_TOKEN = process.env.BEARER_TOKEN || '';
const API_KEY = process.env.API_KEY || '';

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(data));
}

function getIndiaToday() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const map = Object.fromEntries(
    parts
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, p.value])
  );

  return `${map.year}-${map.month}-${map.day}`;
}

function isValidDateString(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || '');
}

function getIndiaDateRange(dateStr) {
  const targetDate = dateStr || getIndiaToday();

  if (!isValidDateString(targetDate)) {
    throw new Error('date 格式必須是 YYYY-MM-DD，例如 2026-09-21');
  }

  const start = new Date(`${targetDate}T00:00:00+05:30`);
  const end = new Date(`${targetDate}T23:59:59+05:30`);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error('無效日期');
  }

  return {
    date: targetDate,
    timezone: 'Asia/Kolkata',
    start_local: `${targetDate} 00:00:00`,
    end_local: `${targetDate} 23:59:59`,
    start_time: Math.floor(start.getTime() / 1000),
    end_time: Math.floor(end.getTime() / 1000),
  };
}

function getRequestedRange(url) {
  const manualStart = url.searchParams.get('start_time');
  const manualEnd = url.searchParams.get('end_time');

  if (manualStart || manualEnd) {
    if (!manualStart || !manualEnd) {
      throw new Error('如果要手動指定 timestamp，start_time 與 end_time 必須一起提供');
    }

    const start = Number(manualStart);
    const end = Number(manualEnd);

    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      throw new Error('start_time / end_time 必須是 Unix timestamp');
    }

    return {
      date: null,
      timezone: 'manual',
      start_local: null,
      end_local: null,
      start_time: Math.floor(start),
      end_time: Math.floor(end),
    };
  }

  const date = url.searchParams.get('date');
  return getIndiaDateRange(date);
}

function buildHeaders() {
  if (!BEARER_TOKEN) {
    throw new Error('Zeabur 環境變數尚未設定 BEARER_TOKEN');
  }

  return {
    accept: 'application/json, text/plain, */*',
    'accept-language': 'zh-CN,zh;q=0.9',
    authorization: `Bearer ${BEARER_TOKEN}`,
    origin: ADMIN_ORIGIN,
    referer: `${ADMIN_ORIGIN}/`,
    'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/151 Safari/537.36',
    'x-language': X_LANGUAGE,
    'x-site': X_SITE,
  };
}

async function requestJson(url) {
  const response = await fetch(url, {
    method: 'GET',
    headers: buildHeaders(),
    signal: AbortSignal.timeout(30000),
  });

  const text = await response.text();
  let data;

  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    const error = new Error(`上游 API 回傳 ${response.status}`);
    error.status = response.status;
    error.upstream = data;
    throw error;
  }

  return data;
}

async function getPromotionChannel(range) {
  const qs = new URLSearchParams({
    'sorts[id]': 'desc',
    start_time: String(range.start_time),
    end_time: String(range.end_time),
    current_page: '1',
    page_size: '10',
  });

  const url = `${API_BASE}/api/ad/report/promotionchannelstat?${qs}`;
  return requestJson(url);
}

async function getMemberLifecycle(range) {
  const qs = new URLSearchParams({
    'sorts[id]': 'desc',
    start_time: String(range.start_time),
    end_time: String(range.end_time),
    view: 'channel',
    actor_type: 'all',
    current_page: '1',
    page_size: '10',
  });

  const url = `${API_BASE}/api/report/member-lifecycle?${qs}`;
  return requestJson(url);
}

function checkApiKey(req) {
  if (!API_KEY) return true;
  return req.headers['x-api-key'] === API_KEY;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (req.method !== 'GET') {
      return sendJson(res, 405, {
        ok: false,
        error: 'Method Not Allowed',
      });
    }

    if (url.pathname === '/health') {
      return sendJson(res, 200, {
        ok: true,
        service: 'zeabur-report-api',
        timezone: 'Asia/Kolkata',
        india_today: getIndiaToday(),
        endpoints: [
          '/promotion-channel',
          '/member-lifecycle',
          '/all',
          '/all?date=2026-09-20',
        ],
      });
    }

    if (!checkApiKey(req)) {
      return sendJson(res, 401, {
        ok: false,
        error: 'Invalid API key',
      });
    }

    if (!['/promotion-channel', '/member-lifecycle', '/all'].includes(url.pathname)) {
      return sendJson(res, 404, {
        ok: false,
        error: 'Not Found',
      });
    }

    const range = getRequestedRange(url);

    if (url.pathname === '/promotion-channel') {
      const data = await getPromotionChannel(range);
      return sendJson(res, 200, {
        ok: true,
        range,
        promotion_channel: data,
      });
    }

    if (url.pathname === '/member-lifecycle') {
      const data = await getMemberLifecycle(range);
      return sendJson(res, 200, {
        ok: true,
        range,
        member_lifecycle: data,
      });
    }

    const [promotionChannel, memberLifecycle] = await Promise.all([
      getPromotionChannel(range),
      getMemberLifecycle(range),
    ]);

    return sendJson(res, 200, {
      ok: true,
      range,
      promotion_channel: promotionChannel,
      member_lifecycle: memberLifecycle,
    });
  } catch (error) {
    console.error(error);

    return sendJson(res, error.status || 500, {
      ok: false,
      error: error.message || 'Internal Server Error',
      upstream: error.upstream || undefined,
    });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`zeabur-report-api listening on http://0.0.0.0:${PORT}`);
  console.log(`India today: ${getIndiaToday()}`);
});
