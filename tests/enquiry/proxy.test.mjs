import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import test from 'node:test';
import { clientIp, createEnquiryServer } from '../../server/enquiry-server.mjs';
import { handleEnquiry, signEnquiry, SIGNED_FIELDS, VISITOR_FAILURE_MESSAGE } from '../../server/enquiry-handler.mjs';

const TOKEN = '0123456789abcdef'.repeat(4);
const SCRIPT_URL = 'https://script.google.com/macros/s/deployment-id/exec';
const SPREADSHEET_ID = '1N2xHXT2t28CdSBkZFihbOxgk9H3kK2-8n0QK2kXrW4M';

function env(overrides = {}) {
  return {
    APPS_SCRIPT_ENQUIRY_URL: SCRIPT_URL,
    ENQUIRY_PROXY_TOKEN: TOKEN,
    ENQUIRY_ALLOWED_ORIGINS: 'https://www.intersacks.co.za,https://intersacks.co.za',
    ...overrides
  };
}

function request(body, overrides = {}) {
  return {
    method: 'POST',
    headers: {
      origin: 'https://www.intersacks.co.za',
      'content-type': 'application/json',
      ...overrides.headers
    },
    bodyText: JSON.stringify(body),
    ip: overrides.ip || '203.0.113.10',
    ...overrides
  };
}

function rateLimit() {
  return { limit: 8, windowMs: 600000, store: new Map() };
}

async function send(body, options = {}) {
  const calls = [];
  const fetchImpl = options.fetchImpl || (async (url, init) => {
    calls.push({ url, init });
    return {
      status: 200,
      json: async () => ({ ok: true, leadId: 'ISD-20261108-0001', duplicate: false, token: TOKEN })
    };
  });
  const result = await handleEnquiry(request(body, options.request), {
    env: env(options.env),
    fetchImpl,
    rateLimit: options.rateLimit || rateLimit(),
    now: options.now,
    timeoutMs: options.timeoutMs
  });
  return { result, calls, body: result.body ? JSON.parse(result.body) : null };
}

const enquiry = {
  name: 'Lesley Naidoo',
  email: 'lesley@example.co.za',
  business: 'Naidoo Studio',
  phone: '084 325 2262',
  service: 'Web Solutions',
  message: 'A new brochure site for the studio.',
  consent: 'yes',
  page: '/contact.html',
  submissionKey: '22222222-2222-4222-8222-222222222222',
  token: 'attacker-supplied-token'
};

test('a valid enquiry is forwarded and the visitor only receives the lead id', async () => {
  const { result, calls, body } = await send(enquiry);
  assert.equal(result.status, 200);
  assert.deepEqual(body, { ok: true, leadId: 'ISD-20261108-0001' });
  assert.equal(calls[0].url, SCRIPT_URL);
  assert.equal(calls[0].url.includes(TOKEN), false);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.redirect, 'follow');
  assert.equal(calls[0].init.signal instanceof AbortSignal, true);
  const upstream = JSON.parse(calls[0].init.body);
  const fields = {};
  for (const key of SIGNED_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(enquiry, key)) fields[key] = enquiry[key];
  }
  const expected = signEnquiry(TOKEN, fields, { timestamp: upstream.timestamp, nonce: upstream.nonce });
  assert.equal(upstream.signature, expected.signature);
  assert.equal(Object.prototype.hasOwnProperty.call(upstream, 'token'), false);
  assert.equal(upstream.submissionKey, enquiry.submissionKey);
  assert.equal(upstream.email, enquiry.email);
  assert.equal(result.body.includes(TOKEN), false);
  assert.equal(result.body.includes(SPREADSHEET_ID), false);
  assert.equal(result.body.includes(upstream.signature), false);
});

test('backend failure and a non-JSON upstream response stay generic', async () => {
  const failure = await send(enquiry, {
    fetchImpl: async () => ({
      status: 200,
      json: async () => ({ ok: false, code: 'INTERNAL', message: `Exception: spreadsheet ${SPREADSHEET_ID}` })
    })
  });
  assert.equal(failure.result.status, 502);
  assert.equal(failure.body.message, VISITOR_FAILURE_MESSAGE);
  assert.equal(failure.result.body.includes('Exception'), false);
  assert.equal(failure.result.body.includes(SPREADSHEET_ID), false);

  const html = await send(enquiry, {
    fetchImpl: async () => ({ status: 500, json: async () => { throw new Error('not json'); } })
  });
  assert.equal(html.result.status, 502);
  assert.equal(html.body.ok, false);
});

test('network failure returns a safe error and does not throw', async () => {
  const { result, body } = await send(enquiry, {
    fetchImpl: async () => { throw new Error(`connect ECONNREFUSED ${SCRIPT_URL}`); }
  });
  assert.equal(result.status, 502);
  assert.equal(body.message, VISITOR_FAILURE_MESSAGE);
  assert.equal(result.body.includes(SCRIPT_URL), false);
  assert.equal(result.body.includes('ECONNREFUSED'), false);
});

test('a validation response from Apps Script is forwarded without the upstream code', async () => {
  const { result, body } = await send(enquiry, {
    fetchImpl: async () => ({
      status: 200,
      json: async () => ({ ok: false, code: 'VALIDATION', message: 'Enter a valid email address.' })
    })
  });
  assert.equal(result.status, 400);
  assert.deepEqual(body, { ok: false, message: 'Enter a valid email address.' });
});

test('a duplicate submission key still resolves as a confirmed save', async () => {
  const { result, calls } = await send(enquiry, {
    fetchImpl: async () => ({ status: 200, json: async () => ({ ok: true, leadId: 'ISD-20261108-0004', duplicate: true }) })
  });
  assert.equal(result.status, 200);
  assert.equal(JSON.parse(result.body).leadId, 'ISD-20261108-0004');
  assert.equal(calls.length, 0);
});

test('the proxy refuses to call Apps Script when it is not configured', async () => {
  let called = false;
  const { result, body } = await send(enquiry, {
    env: { APPS_SCRIPT_ENQUIRY_URL: '', ENQUIRY_PROXY_TOKEN: '' },
    fetchImpl: async () => { called = true; return { status: 200, json: async () => ({ ok: true, leadId: 'ISD-1' }) }; }
  });
  assert.equal(called, false);
  assert.equal(result.status, 503);
  assert.equal(body.message, VISITOR_FAILURE_MESSAGE);

  let shortCalled = false;
  const short = await send(enquiry, {
    env: { ENQUIRY_PROXY_TOKEN: '0123456789abcdef' },
    fetchImpl: async () => { shortCalled = true; return { status: 200, json: async () => ({ ok: true, leadId: 'ISD-1' }) }; }
  });
  assert.equal(shortCalled, false);
  assert.equal(short.result.status, 503);
});

test('a disallowed origin is rejected before the upstream call', async () => {
  let called = false;
  const { result } = await send(enquiry, {
    request: { headers: { origin: 'https://evil.example', 'content-type': 'application/json' } },
    fetchImpl: async () => { called = true; return { status: 200, json: async () => ({ ok: true, leadId: 'ISD-1' }) }; }
  });
  assert.equal(called, false);
  assert.equal(result.status, 403);
  assert.equal(result.headers['Access-Control-Allow-Origin'], undefined);
});

test('an upstream timeout aborts the request and stays generic', async () => {
  let aborted = false;
  const { result, body } = await send(enquiry, {
    timeoutMs: 30,
    fetchImpl: (url, init) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        resolve({ status: 200, json: async () => ({ ok: true, leadId: 'ISD-late' }) });
      }, 500);
      init.signal.addEventListener('abort', () => {
        aborted = true;
        clearTimeout(timer);
        const error = new Error('The operation was aborted');
        error.name = 'AbortError';
        reject(error);
      });
    })
  });
  assert.equal(aborted, true);
  assert.equal(result.status, 504);
  assert.equal(body.message, VISITOR_FAILURE_MESSAGE);
  assert.equal(/abort|timeout|script\.google|Exception/i.test(result.body), false);
});

test('authentication failures from Apps Script are not shown to the visitor', async () => {
  for (const code of ['UNAUTHORISED', 'EXPIRED', 'REPLAY']) {
    const { result, body } = await send(enquiry, {
      fetchImpl: async () => ({
        status: 200,
        json: async () => ({ ok: false, code, message: `Rejected ${code} for token ${TOKEN}` })
      })
    });
    assert.equal(result.status, 502, code);
    assert.equal(body.message, VISITOR_FAILURE_MESSAGE);
    assert.equal(result.body.includes(TOKEN), false);
    assert.equal(result.body.includes(code), false);
  }
});

test('the in-memory limiter forgets idle addresses and caps the whole process', async () => {
  const store = new Map();
  const globalHits = [];
  const limit = { limit: 1, windowMs: 1000, globalLimit: 10, globalWindowMs: 10000, store, globalHits };
  const fetchImpl = async () => ({ status: 200, json: async () => ({ ok: true, leadId: 'ISD-20261108-0001' }) });
  const first = await send(enquiry, { rateLimit: limit, fetchImpl, now: () => 1000, request: { ip: '198.51.100.8' } });
  const blocked = await send(enquiry, { rateLimit: limit, fetchImpl, now: () => 1500, request: { ip: '198.51.100.8' } });
  const later = await send(enquiry, { rateLimit: limit, fetchImpl, now: () => 2500, request: { ip: '198.51.100.8' } });
  assert.equal(first.result.status, 200);
  assert.equal(blocked.result.status, 429);
  assert.equal(later.result.status, 200);
  assert.equal(store.has('198.51.100.8'), true);

  const globalStore = new Map();
  const global = { limit: 5, windowMs: 60000, globalLimit: 2, globalWindowMs: 60000, store: globalStore, globalHits: [] };
  const one = await send(enquiry, { rateLimit: global, fetchImpl, request: { ip: '198.51.100.1' } });
  const two = await send(enquiry, { rateLimit: global, fetchImpl, request: { ip: '198.51.100.2' } });
  const three = await send(enquiry, { rateLimit: global, fetchImpl, request: { ip: '198.51.100.3' } });
  assert.equal(one.result.status, 200);
  assert.equal(two.result.status, 200);
  assert.equal(three.result.status, 429);
});

test('repeated calls from one address are rate limited', async () => {
  const limit = rateLimit();
  limit.limit = 2;
  const fetchImpl = async () => ({ status: 200, json: async () => ({ ok: true, leadId: 'ISD-20261108-0001' }) });
  const first = await send(enquiry, { rateLimit: limit, fetchImpl });
  const second = await send(enquiry, { rateLimit: limit, fetchImpl });
  const third = await send(enquiry, { rateLimit: limit, fetchImpl });
  assert.equal(first.result.status, 200);
  assert.equal(second.result.status, 200);
  assert.equal(third.result.status, 429);
  assert.equal(third.body.message, 'Please wait a few minutes and try again.');
});

test('untrusted forwarded headers are ignored', () => {
  const req = {
    headers: { 'x-forwarded-for': '198.51.100.8, 203.0.113.9' },
    socket: { remoteAddress: '10.0.0.8' }
  };
  assert.equal(clientIp(req, {}), '10.0.0.8');
  assert.equal(clientIp(req, { ENQUIRY_TRUST_PROXY: 'false' }), '10.0.0.8');
  assert.equal(clientIp(req, { ENQUIRY_TRUST_PROXY: '1' }), '10.0.0.8');
  assert.equal(clientIp(req, { ENQUIRY_TRUST_PROXY: 'yes' }), '10.0.0.8');
});

test('a trusted proxy uses the address it observed', () => {
  const req = {
    headers: { 'x-forwarded-for': '198.51.100.8, 203.0.113.9' },
    socket: { remoteAddress: '10.0.0.8' }
  };
  assert.equal(clientIp(req, { ENQUIRY_TRUST_PROXY: 'true' }), '203.0.113.9');
  assert.equal(clientIp(req, { ENQUIRY_TRUST_PROXY: 'TRUE' }), '203.0.113.9');
  const chained = {
    headers: { 'x-forwarded-for': '198.51.100.8, 203.0.113.9, 10.1.1.1' },
    socket: { remoteAddress: '10.0.0.8' }
  };
  assert.equal(clientIp(chained, { ENQUIRY_TRUST_PROXY: 'true', ENQUIRY_TRUSTED_HOPS: '1' }), '203.0.113.9');
  const junk = {
    headers: { 'x-forwarded-for': 'not-an-ip' },
    socket: { remoteAddress: '10.0.0.8' }
  };
  assert.equal(clientIp(junk, { ENQUIRY_TRUST_PROXY: 'true' }), '10.0.0.8');
  const missing = { headers: {}, socket: { remoteAddress: '10.0.0.8' } };
  assert.equal(clientIp(missing, { ENQUIRY_TRUST_PROXY: 'true' }), '10.0.0.8');
});

test('the HTTP server ignores a client-supplied forwarding header', async () => {
  const server = createEnquiryServer({
    env: env(),
    rateLimit: { limit: 1, windowMs: 600000, store: new Map() },
    fetchImpl: async () => ({ status: 200, json: async () => ({ ok: true, leadId: 'ISD-20261108-0001' }) })
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  try {
    const first = await fetch(`http://127.0.0.1:${port}/api/enquiry`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://www.intersacks.co.za',
        'X-Forwarded-For': '198.51.100.1'
      },
      body: JSON.stringify(enquiry)
    });
    const second = await fetch(`http://127.0.0.1:${port}/api/enquiry`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://www.intersacks.co.za',
        'X-Forwarded-For': '198.51.100.2',
        'X-Real-IP': '198.51.100.3'
      },
      body: JSON.stringify(enquiry)
    });
    assert.equal(first.status, 200);
    assert.equal(second.status, 429);
  } finally {
    server.close();
  }
});

test('the HTTP server rate-limits the address observed by a trusted proxy', async () => {
  const server = createEnquiryServer({
    env: env({ ENQUIRY_TRUST_PROXY: 'true' }),
    rateLimit: { limit: 1, windowMs: 600000, store: new Map() },
    fetchImpl: async () => ({ status: 200, json: async () => ({ ok: true, leadId: 'ISD-20261108-0001' }) })
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  const postAs = (forwarded) => fetch(`http://127.0.0.1:${port}/api/enquiry`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://www.intersacks.co.za',
      'X-Forwarded-For': forwarded
    },
    body: JSON.stringify(enquiry)
  });
  try {
    const spoofedSameClient = await postAs('198.51.100.8, 203.0.113.9');
    const differentPrefix = await postAs('203.0.113.50, 203.0.113.9');
    const otherClient = await postAs('198.51.100.8, 203.0.113.10');
    assert.equal(spoofedSameClient.status, 200);
    assert.equal(differentPrefix.status, 429);
    assert.equal(otherClient.status, 200);
  } finally {
    server.close();
  }
});

test('the HTTP server confirms a save and hides upstream failures', async () => {
  const calls = [];
  const server = createEnquiryServer({
    env: env(),
    rateLimit: rateLimit(),
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return { status: 200, json: async () => ({ ok: true, leadId: 'ISD-20261108-0009' }) };
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/enquiry`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://www.intersacks.co.za'
      },
      body: JSON.stringify(enquiry)
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(body, { ok: true, leadId: 'ISD-20261108-0009' });
    assert.equal(calls.length, 1);
    const upstream = JSON.parse(calls[0].init.body);
    assert.equal(typeof upstream.signature, 'string');
    assert.equal(upstream.signature.length, 64);
    assert.equal(Object.prototype.hasOwnProperty.call(upstream, 'token'), false);

    const missing = await fetch(`http://127.0.0.1:${port}/api/other`, { method: 'POST' });
    assert.equal(missing.status, 404);

    const failedServer = createEnquiryServer({
      env: env(),
      rateLimit: rateLimit(),
      fetchImpl: async () => { throw new Error('socket hang up'); }
    });
    failedServer.listen(0, '127.0.0.1');
    await once(failedServer, 'listening');
    const failedPort = failedServer.address().port;
    try {
      const failed = await fetch(`http://127.0.0.1:${failedPort}/api/enquiry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'https://intersacks.co.za' },
        body: JSON.stringify(enquiry)
      });
      const failedBody = await failed.json();
      assert.equal(failed.status, 502);
      assert.equal(failedBody.message, VISITOR_FAILURE_MESSAGE);
      assert.equal(JSON.stringify(failedBody).includes('socket'), false);
    } finally {
      failedServer.close();
    }
  } finally {
    server.close();
  }
});
