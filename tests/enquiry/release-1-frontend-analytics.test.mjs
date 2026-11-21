/**
 * Release 1 tests for the contact-form controller and js/analytics.js.
 * Both run in a Node vm with fake DOM objects. No network is used.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const formSource = readFileSync(fileURLToPath(new URL('../../js/enquiry-form.js', import.meta.url)), 'utf8');
const analyticsSource = readFileSync(fileURLToPath(new URL('../../js/analytics.js', import.meta.url)), 'utf8');
const EXEC = 'https://script.google.com/macros/s/AKfycbxTESTDEPLOYMENT/exec';
const KEY = '55555555-5555-4555-8555-555555555555';
const GOOGLE = 'https://n-abc123-0lu-script.googleusercontent.com';
const PII = ['Sipho Dlamini', 'sipho@example.co.za', '083 555 0123', 'Dlamini Plumbing', 'secret project'];

function classList() {
  const names = new Set();
  return { toggle(name, on) { if (on === undefined ? !names.has(name) : on) names.add(name); else names.delete(name); }, contains: (name) => names.has(name) };
}

function fakeForm(values = {}) {
  const state = { name: 'Sipho Dlamini', email: 'sipho@example.co.za', business: 'Dlamini Plumbing', phone: '083 555 0123', service: 'Business Automation', message: 'secret project', fax_number: '', ...values };
  const hidden = {};
  const form = {
    status: { textContent: '', classList: classList() },
    attributes: { 'data-enquiry-endpoint': EXEC },
    submitCount: 0,
    resetCount: 0,
    hidden,
    getAttribute(name) { return this.attributes[name] ?? null; },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    reportValidity() { return true; },
    reset() { this.resetCount += 1; Object.keys(state).forEach((key) => { state[key] = ''; }); },
    submit() { this.submitCount += 1; },
    appendChild(node) { hidden[node.name] = node; return node; },
    elements: {
      namedItem(name) {
        if (name === 'service') return [{ type: 'radio', checked: true, value: state.service }];
        if (hidden[name]) return hidden[name];
        return Object.prototype.hasOwnProperty.call(state, name) ? { type: 'text', value: state[name] } : null;
      }
    },
    querySelector(selector) {
      if (selector === '#form-status') return this.status;
      if (selector === 'button[type="submit"]') return this.button;
      const match = /^\[name="([^"]+)"\]$/.exec(selector);
      return match ? hidden[match[1]] || null : null;
    },
    addEventListener() {}
  };
  form.button = { disabled: false, classList: classList(), setAttribute() {} };
  return form;
}

function controller({ values, clock } = {}) {
  let time = 1_000_000;
  const timers = [];
  const sandbox = {
    Date, String, Number, Boolean, Array, Object, Math,
    setTimeout(fn) { timers.push(fn); return timers.length; },
    clearTimeout() {},
    document: { createElement: () => ({ type: '', name: '', value: '' }) }
  };
  sandbox.window = sandbox;
  runInNewContext(formSource, sandbox);
  const form = fakeForm(values);
  const leads = [];
  const api = sandbox.createEnquiryController({
    form,
    mailtoFallback() {},
    addWindowListener() {},
    createKey: () => KEY,
    now: () => time,
    onLeadConfirmed: (detail) => leads.push(detail)
  });
  return { api, form, leads, timers, advance(ms) { time += ms; }, clock };
}

const success = (extra = {}) => ({ origin: GOOGLE, data: { ok: true, channel: 'intersacks-enquiry', reference: 'ISD-20261121-0007', submissionKey: KEY, status: 'RECEIVED', ...extra } });

test('the form reports how long it was open, measured from page load', () => {
  const run = controller();
  run.advance(8250);
  run.api.onSubmit({ preventDefault() {} });
  assert.equal(run.form.submitCount, 1);
  assert.equal(run.form.hidden.formElapsedMs.value, '8250');
});

test('a confirmed save announces one lead with only the reference and service', () => {
  const run = controller();
  run.advance(5000);
  run.api.onSubmit({ preventDefault() {} });
  run.api.onMessage(success());
  run.api.onMessage(success());
  assert.equal(run.leads.length, 1);
  assert.deepEqual(Object.keys(run.leads[0]).sort(), ['reference', 'service']);
  assert.equal(run.leads[0].service, 'Business Automation');
  const text = JSON.stringify(run.leads);
  for (const value of PII) assert.equal(text.includes(value), false, value);
});

test('no lead is announced before or without a confirmed save', () => {
  const cases = [
    () => {},
    (run) => run.timers[0](),
    (run) => run.api.onMessage({ origin: 'https://evil.example', data: success().data }),
    (run) => run.api.onMessage(success({ ok: false, code: 'VALIDATION', message: 'Enter your full name.' })),
    (run) => run.api.onMessage(success({ code: 'TEST_MODE' })),
    (run) => run.api.onMessage(success({ reference: '' })),
    (run) => run.api.onMessage(success({ submissionKey: '66666666-6666-4666-8666-666666666666' })),
    (run) => run.api.onMessage(success({ duplicate: true }))
  ];
  for (const [index, act] of cases.entries()) {
    const run = controller();
    run.advance(5000);
    run.api.onSubmit({ preventDefault() {} });
    act(run);
    assert.equal(run.leads.length, 0, `case ${index}`);
  }
});

test('a saved enquiry whose acknowledgement email failed is still counted as a lead', () => {
  const run = controller();
  run.advance(5000);
  run.api.onSubmit({ preventDefault() {} });
  run.api.onMessage(success({ customerEmail: 'failed' }));
  assert.equal(run.leads.length, 1);
});

test('client-side email validation rejects address lists and display names', () => {
  for (const email of ['a@b.com,c@d.com', 'a@b.com;c@d.com', 'Name <a@b.com>', 'a..b@c.com', 'a@b']) {
    const run = controller({ values: { email } });
    run.api.onSubmit({ preventDefault() {} });
    assert.equal(run.form.submitCount, 0, email);
    assert.match(run.form.status.textContent, /valid email/i, email);
  }
});

function analytics({ hostname = 'www.intersacks.co.za' } = {}) {
  const listeners = {};
  const appended = [];
  const sandbox = {
    Object, Array, String, Date, Math,
    location: { hostname, pathname: '/contact.html' },
    document: {
      readyState: 'complete',
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: () => ({}),
      head: { appendChild(node) { appended.push(node); } },
      addEventListener() {}
    },
    addEventListener(type, fn) { listeners[type] = fn; },
    IntersectionObserver: undefined
  };
  sandbox.window = sandbox;
  runInNewContext(analyticsSource, sandbox);
  // JSON copy: objects created inside the vm have a different prototype.
  const events = () => JSON.parse(JSON.stringify(sandbox.dataLayer.map((item) => Array.from(item)).filter((item) => item[0] === 'event').map((item) => ({ name: item[1], params: item[2] }))));
  return { sandbox, listeners, appended, events };
}

test('generate_lead is sent once per reference with no personal information', () => {
  const run = analytics();
  const fire = (detail) => run.listeners['intersacks:lead-confirmed']({ detail });
  fire({ reference: 'ISD-20261121-0007', service: 'AI & Software', email: 'sipho@example.co.za', name: 'Sipho Dlamini', phone: '083 555 0123' });
  fire({ reference: 'ISD-20261121-0007', service: 'AI & Software' });
  fire({ reference: 'not-a-reference', service: 'Branding' });
  fire({ reference: 'ISD-20261121-0008', service: 'Catering' });
  const leads = run.events().filter((event) => event.name === 'generate_lead');
  assert.equal(leads.length, 2);
  assert.deepEqual(leads[0].params, { page_path: '/contact.html', link_location: 'contact', service_name: 'AI and Software', transport_type: 'beacon' });
  assert.equal('service_name' in leads[1].params, false);
  const text = JSON.stringify(run.events());
  for (const value of [...PII, 'ISD-']) assert.equal(text.includes(value), false, value);
});

test('the production tag uses the active ID with Google signals and ad personalisation off', () => {
  const run = analytics();
  assert.equal(run.appended.length, 1);
  assert.match(run.appended[0].src, /gtag\/js\?id=G-XCN1MN0GHR$/);
  const config = JSON.parse(JSON.stringify(run.sandbox.dataLayer.map((item) => Array.from(item)).find((item) => item[0] === 'config')));
  assert.deepEqual(config, ['config', 'G-XCN1MN0GHR', { allow_google_signals: false, allow_ad_personalization_signals: false }]);
});

test('non-production hosts never load the Google tag', () => {
  const run = analytics({ hostname: '127.0.0.1' });
  assert.equal(run.appended.length, 0);
  assert.equal(run.sandbox.dataLayer.some((item) => item[0] === 'config'), false);
});

test('loading analytics twice does not double-count events', () => {
  const run = analytics();
  runInNewContext(analyticsSource, run.sandbox);
  run.listeners['intersacks:lead-confirmed']({ detail: { reference: 'ISD-20261121-0009', service: 'Branding' } });
  assert.equal(run.appended.length, 1);
  assert.equal(run.events().filter((event) => event.name === 'generate_lead').length, 1);
});
