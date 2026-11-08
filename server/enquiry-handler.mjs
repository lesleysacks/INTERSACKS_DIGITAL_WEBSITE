/**
 * Host-agnostic proxy between the website form and the Apps Script web app.
 *
 * The browser never receives the Apps Script URL or the shared secret.
 * Each upstream request is signed with HMAC-SHA256 over a timestamp, a
 * nonce, and the enquiry fields. Apps Script web apps answer doPost with
 * HTTP 200 even when the JSON reports a failure, so this handler trusts
 * the JSON `ok` field.
 *
 * The canonical string must stay identical to canonicalMessage_ in
 * apps-script/EnquiryWebApp.gs.
 */
import crypto from 'node:crypto';

export const VISITOR_FAILURE_MESSAGE = 'We could not send your enquiry. Please try again, or email lesleysacks1@gmail.com or call 084 325 2262.';

export const SIGNED_FIELDS = [
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

export function canonicalMessage(fields, timestamp, nonce) {
  const ordered = {};
  for (const key of SIGNED_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(fields, key)) ordered[key] = fields[key];
  }
  return `enquiry.v1\n${timestamp}\n${nonce}\n${JSON.stringify(ordered)}`;
}

export function signEnquiry(secret, fields, options = {}) {
  const timestamp = Math.trunc(Number(options.timestamp != null ? options.timestamp : Math.floor(Date.now() / 1000)));
  const nonce = options.nonce || crypto.randomBytes(16).toString('hex');
  const message = canonicalMessage(fields, timestamp, nonce);
  // `secret` is the 64-character hex string, UTF-8 encoded. Apps Script
  // hashes that same string. Do not decode it to raw bytes here only.
  const signature = crypto.createHmac('sha256', secret).update(message).digest('hex');
  return { timestamp, nonce, signature, message };
}

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
  const rateLimit = normaliseRateLimit(options.rateLimit, env);
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
  // Same 64-character hex string as EnquiryWebApp.gs. Both sides use it as
  // UTF-8 HMAC key material. 64 hex characters represent 32 bytes of entropy.
  if (!scriptUrl || token.length < 64) {
    return json(503, { ok: false, message: VISITOR_FAILURE_MESSAGE }, cors);
  }

  const ip = request.ip || 'unknown';
  const shared = request.sharedIp === true || ip === 'unknown';
  if (!takeRateSlot(rateLimit, ip, now(), shared)) {
    return json(429, { ok: false, message: 'Please wait a few minutes and try again.' }, cors);
  }

  const fields = {};
  for (const field of SIGNED_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(clientBody, field)) fields[field] = clientBody[field];
  }
  const signed = signEnquiry(token, fields, {
    timestamp: Math.floor(now() / 1000),
    nonce: crypto.randomBytes(16).toString('hex')
  });
  const upstreamBody = {
    ...fields,
    timestamp: signed.timestamp,
    nonce: signed.nonce,
    signature: signed.signature
  };
  const timeoutMs = resolveTimeout(env, options.timeoutMs);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (typeof timer.unref === 'function') timer.unref();

  return fetchImpl(scriptUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify(upstreamBody),
    redirect: 'follow',
    signal: controller.signal
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
  }).catch((error) => {
    if (error && error.name === 'AbortError') {
      return json(504, { ok: false, message: VISITOR_FAILURE_MESSAGE }, cors);
    }
    return json(502, { ok: false, message: VISITOR_FAILURE_MESSAGE }, cors);
  }).finally(() => clearTimeout(timer));
}

function resolveTimeout(env, override) {
  if (override != null) {
    const value = Number(override);
    if (Number.isFinite(value) && value >= 10) return Math.trunc(value);
  }
  const configured = Number(env.ENQUIRY_UPSTREAM_TIMEOUT_MS);
  if (!Number.isFinite(configured) || configured <= 0) return 15000;
  return Math.min(Math.max(Math.trunc(configured), 1000), 30000);
}

function normaliseRateLimit(rateLimit, env) {
  const source = rateLimit || defaultRateLimit;
  if (!Array.isArray(source.globalHits)) source.globalHits = rateLimit ? [] : defaultGlobalHits;
  if (!source.limit) source.limit = positiveInt(env.ENQUIRY_RATE_LIMIT, 8);
  if (!source.sharedLimit) source.sharedLimit = positiveInt(env.ENQUIRY_SHARED_RATE_LIMIT, 60);
  if (!source.windowMs) source.windowMs = positiveInt(env.ENQUIRY_RATE_WINDOW_MS, 10 * 60 * 1000);
  if (!source.globalLimit) source.globalLimit = positiveInt(env.ENQUIRY_GLOBAL_RATE_LIMIT, 60);
  if (!source.globalWindowMs) source.globalWindowMs = positiveInt(env.ENQUIRY_GLOBAL_RATE_WINDOW_MS, 60 * 1000);
  if (!source.store) source.store = defaultRateStore;
  return source;
}

function positiveInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.trunc(parsed);
}

function takeRateSlot(rateLimit, ip, now, shared) {
  const store = rateLimit.store;
  for (const [key, stamps] of store) {
    const fresh = stamps.filter((stamp) => now - stamp < rateLimit.windowMs);
    if (fresh.length === 0) store.delete(key);
    else if (fresh.length !== stamps.length) store.set(key, fresh);
  }
  const globalHits = rateLimit.globalHits.filter((stamp) => now - stamp < rateLimit.globalWindowMs);
  rateLimit.globalHits = globalHits;
  if (globalHits.length >= rateLimit.globalLimit) return false;

  const limit = shared ? rateLimit.sharedLimit : rateLimit.limit;
  const recent = store.get(ip) || [];
  if (recent.length >= limit) return false;
  recent.push(now);
  globalHits.push(now);
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
const defaultGlobalHits = [];
const defaultRateLimit = {
  store: defaultRateStore,
  globalHits: defaultGlobalHits
};
