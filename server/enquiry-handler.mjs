/**
 * Host-agnostic proxy between the website form and the Apps Script web app.
 *
 * The browser never receives the Apps Script URL or the shared token.
 * Apps Script web apps answer doPost with HTTP 200 even when the JSON
 * reports a failure, so this handler trusts the JSON `ok` field.
 */

export const VISITOR_FAILURE_MESSAGE = 'We could not send your enquiry. Please try again, or email lesleysacks1@gmail.com or call 084 325 2262.';

const FORWARDED_FIELDS = [
  'name',
  'email',
  'business',
  'phone',
  'service',
  'message',
  'consent',
  'page',
  'submissionKey',
  'fax_number'
];

const SAFE_STATUS = {
  VALIDATION: 400,
  RATE_LIMIT: 429,
  LOCKED: 503
};

const SAFE_MESSAGE = /^[A-Za-z0-9 ,.'’\-()]{8,200}$/;

const DEFAULT_ORIGINS = [
  'https://www.intersacks.co.za',
  'https://intersacks.co.za'
];

export function handleEnquiry(request, options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const now = options.now || Date.now;
  const rateLimit = options.rateLimit || {
    limit: 8,
    windowMs: 10 * 60 * 1000,
    store: defaultRateStore
  };
  const allowedOrigins = parseOrigins(env.ENQUIRY_ALLOWED_ORIGINS);
  const origin = header(request.headers, 'origin');
  const cors = corsHeaders(origin, allowedOrigins);

  if (request.method === 'OPTIONS') {
    if (origin && !cors['Access-Control-Allow-Origin']) {
      return json(403, { ok: false, message: VISITOR_FAILURE_MESSAGE }, {});
    }
    return { status: 204, headers: { ...cors, 'Cache-Control': 'no-store' }, body: '' };
  }

  if (request.method !== 'POST') {
    return json(405, { ok: false, message: 'Send the enquiry with POST.' }, cors);
  }

  if (origin && !cors['Access-Control-Allow-Origin']) {
    return json(403, { ok: false, message: VISITOR_FAILURE_MESSAGE }, {});
  }

  const contentType = header(request.headers, 'content-type');
  if (!contentType.toLowerCase().includes('application/json')) {
    return json(400, { ok: false, message: 'Check the enquiry and try again.' }, cors);
  }

  const bodyText = typeof request.bodyText === 'string' ? request.bodyText : '';
  if (bodyText.length > 20000) {
    return json(400, { ok: false, message: 'Check the enquiry and try again.' }, cors);
  }

  let clientBody;
  try {
    clientBody = JSON.parse(bodyText || '');
  } catch (error) {
    return json(400, { ok: false, message: 'Check the enquiry and try again.' }, cors);
  }
  if (!clientBody || typeof clientBody !== 'object' || Array.isArray(clientBody)) {
    return json(400, { ok: false, message: 'Check the enquiry and try again.' }, cors);
  }

  const scriptUrl = String(env.APPS_SCRIPT_ENQUIRY_URL || '').trim();
  const token = String(env.ENQUIRY_PROXY_TOKEN || '');
  if (!scriptUrl || token.length < 16) {
    return json(503, { ok: false, message: VISITOR_FAILURE_MESSAGE }, cors);
  }

  const ip = request.ip || 'unknown';
  if (!takeRateSlot(rateLimit, ip, now())) {
    return json(429, { ok: false, message: 'Please wait a few minutes and try again.' }, cors);
  }

  const upstreamBody = { token };
  for (const field of FORWARDED_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(clientBody, field)) upstreamBody[field] = clientBody[field];
  }

  return fetchImpl(scriptUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify(upstreamBody),
    redirect: 'follow'
  }).then(async (response) => {
    let data = null;
    try {
      data = await response.json();
    } catch (error) {
      data = null;
    }
    if (data && data.ok === true && typeof data.leadId === 'string' && data.leadId.trim()) {
      return json(200, { ok: true, leadId: data.leadId.trim() }, cors);
    }
    const code = data && typeof data.code === 'string' ? data.code : '';
    const message = data && typeof data.message === 'string' ? data.message.trim() : '';
    if (SAFE_STATUS[code] && SAFE_MESSAGE.test(message)) {
      return json(SAFE_STATUS[code], { ok: false, message }, cors);
    }
    return json(502, { ok: false, message: VISITOR_FAILURE_MESSAGE }, cors);
  }).catch(() => json(502, { ok: false, message: VISITOR_FAILURE_MESSAGE }, cors));
}

function takeRateSlot(rateLimit, ip, now) {
  const store = rateLimit.store;
  const recent = (store.get(ip) || []).filter((stamp) => now - stamp < rateLimit.windowMs);
  if (recent.length >= rateLimit.limit) {
    store.set(ip, recent);
    return false;
  }
  recent.push(now);
  store.set(ip, recent);
  return true;
}

function parseOrigins(value) {
  if (!value || !String(value).trim()) return DEFAULT_ORIGINS.slice();
  return String(value).split(',').map((item) => item.trim()).filter(Boolean);
}

function header(headers, name) {
  if (!headers) return '';
  const target = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === target) return String(headers[key] || '');
  }
  return '';
}

function corsHeaders(origin, allowedOrigins) {
  const headers = {
    Vary: 'Origin',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept',
    'Access-Control-Max-Age': '600'
  };
  if (origin && allowedOrigins.indexOf(origin) !== -1) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

function json(status, body, extraHeaders) {
  return {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders
    },
    body: JSON.stringify(body)
  };
}

const defaultRateStore = new Map();
