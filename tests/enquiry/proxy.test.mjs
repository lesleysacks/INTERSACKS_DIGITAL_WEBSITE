import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import test from 'node:test';
import { createEnquiryServer } from '../../server/enquiry-server.mjs';
import { handleEnquiry, VISITOR_FAILURE_MESSAGE } from '../../server/enquiry-handler.mjs';

const TOKEN = 'proxy-token-value-0123456789';
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
    rateLimit: options.rateLimit || rateLimit()
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
  const upstream = JSON.parse(calls[0].init.body);
  assert.equal(upstream.token, TOKEN);
  assert.equal(upstream.submissionKey, enquiry.submissionKey);
  assert.equal(upstream.email, enquiry.email);
  assert.equal(Object.prototype.hasOwnProperty.call(upstream, 'unexpected'), false);
  assert.equal(result.body.includes(TOKEN), false);
  assert.equal(result.body.includes(SPREADSHEET_ID), false);
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
    assert.equal(JSON.parse(calls[0].init.body).token, TOKEN);

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
