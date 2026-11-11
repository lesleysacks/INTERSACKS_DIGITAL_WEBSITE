import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const source = readFileSync(fileURLToPath(new URL('../../js/enquiry-form.js', import.meta.url)), 'utf8');
const scriptSource = readFileSync(fileURLToPath(new URL('../../js/script.js', import.meta.url)), 'utf8');
const appsScript = readFileSync(fileURLToPath(new URL('../../apps-script/EnquiryWebApp.gs', import.meta.url)), 'utf8');
const EXEC = 'https://script.google.com/macros/s/AKfycbxTESTDEPLOYMENT/exec';

function classList() {
  const names = new Set();
  return {
    toggle(name, on) {
      const force = on === undefined ? !names.has(name) : Boolean(on);
      if (force) names.add(name);
      else names.delete(name);
    },
    contains(name) { return names.has(name); }
  };
}

function fakeForm(initial = {}) {
  const state = {
    name: 'Lesley Naidoo',
    email: 'lesley@example.co.za',
    business: 'Naidoo Studio',
    phone: '084 325 2262',
    service: 'Web Solutions',
    message: 'A new brochure site for the studio.',
    fax_number: '',
    submissionKey: '',
    page: '',
    responseFormat: '',
    ...initial.values
  };
  const hidden = {};
  const form = {
    state,
    status: { textContent: 'Submitting records your enquiry.', classList: classList() },
    button: null,
    valid: initial.valid !== false,
    resetCount: 0,
    submitCount: 0,
    action: '',
    method: 'post',
    target: 'enquiry-response',
    attributes: {
      'data-enquiry-endpoint': initial.endpoint === undefined ? EXEC : initial.endpoint,
      'aria-busy': 'false'
    },
    children: [],
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null; },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    reportValidity() { return this.valid; },
    reset() {
      this.resetCount += 1;
      state.name = '';
      state.email = '';
      state.business = '';
      state.phone = '';
      state.service = '';
      state.message = '';
      state.fax_number = '';
    },
    submit() { this.submitCount += 1; },
    appendChild(node) { this.children.push(node); hidden[node.name] = node; return node; },
    elements: {
      namedItem: (name) => {
        if (name === 'service') {
          return [{ type: 'radio', checked: true, value: state.service }];
        }
        if (!Object.prototype.hasOwnProperty.call(state, name) && !hidden[name]) return null;
        if (hidden[name]) return hidden[name];
        return { type: 'text', value: state[name] };
      }
    },
    querySelector(selector) {
      if (selector === '#form-status') return this.status;
      if (selector === 'button[type="submit"]') return this.button;
      const hiddenName = /^\[name="([^"]+)"\]$/.exec(selector);
      if (hiddenName) return hidden[hiddenName[1]] || { name: hiddenName[1], value: state[hiddenName[1]] || '' };
      return null;
    },
    addEventListener(type, listener) {
      this.listeners = this.listeners || {};
      this.listeners[type] = listener;
    }
  };
  form.button = {
    disabled: false,
    classList: classList(),
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = String(value); }
  };
  return form;
}

function loadController(formOptions = {}) {
  const timers = [];
  const sandbox = {
    Date,
    String,
    Number,
    Boolean,
    Array,
    Object,
    Math,
    setTimeout(fn, ms) {
      const id = timers.length + 1;
      timers.push({ id, fn, ms, cleared: false });
      return id;
    },
    clearTimeout(id) {
      const item = timers.find((timer) => timer.id === id);
      if (item) item.cleared = true;
    },
    document: {
      createElement(tag) {
        return { tagName: tag, type: '', name: '', value: '' };
      }
    },
    crypto: { randomUUID() { return '22222222-2222-4222-8222-222222222222'; } }
  };
  sandbox.window = sandbox;
  runInNewContext(source, sandbox, { filename: 'enquiry-form.js' });
  const form = fakeForm(formOptions);
  const mailtoCalls = [];
  const controller = sandbox.createEnquiryController({
    form,
    mailtoFallback(target) { mailtoCalls.push(target); },
    addWindowListener() {},
    createKey() { return '22222222-2222-4222-8222-222222222222'; }
  });
  return { sandbox, form, controller, timers, mailtoCalls };
}

test('empty Apps Script endpoint keeps the mailto fallback', () => {
  const runtime = loadController({ endpoint: '' });
  runtime.controller.onSubmit({ preventDefault() {} });
  assert.equal(runtime.mailtoCalls.length, 1);
  assert.equal(runtime.form.submitCount, 0);
});

test('placeholder deployment URL does not pretend the enquiry was saved', () => {
  const runtime = loadController({ endpoint: 'https://script.google.com/macros/s/DEPLOYMENT_ID/exec' });
  runtime.controller.onSubmit({ preventDefault() {} });
  assert.equal(runtime.mailtoCalls.length, 1);
  assert.equal(runtime.form.submitCount, 0);
  assert.equal(runtime.form.status.classList.contains('is-success'), false);
});

test('configured endpoint POSTs to the hidden iframe and waits', () => {
  const runtime = loadController();
  runtime.controller.onSubmit({ preventDefault() {} });
  assert.equal(runtime.mailtoCalls.length, 0);
  assert.equal(runtime.form.submitCount, 1);
  assert.equal(runtime.form.action, EXEC);
  assert.equal(runtime.form.target, 'enquiry-response');
  assert.equal(runtime.form.method, 'post');
  assert.match(runtime.form.status.textContent, /Sending/);
  assert.equal(runtime.form.status.classList.contains('is-success'), false);
  assert.equal(runtime.form.button.disabled, true);
});

test('success is shown only after a trusted postMessage with a reference', () => {
  const runtime = loadController();
  runtime.controller.onSubmit({ preventDefault() {} });
  runtime.controller.onMessage({
    origin: 'https://n-abc123-script.googleusercontent.com',
    data: {
      ok: true,
      channel: 'intersacks-enquiry',
      reference: 'ISD-20261110-0001',
      submissionKey: '22222222-2222-4222-8222-222222222222',
      status: 'RECEIVED'
    }
  });
  assert.equal(runtime.form.resetCount, 1);
  assert.match(runtime.form.status.textContent, /ISD-20261110-0001/);
  assert.match(runtime.form.status.textContent, /not a confirmed booking/i);
  assert.equal(runtime.form.status.classList.contains('is-success'), true);
  assert.equal(runtime.form.button.disabled, false);
});

test('a saved enquiry with a failed email is not described as emailed', () => {
  const runtime = loadController();
  runtime.controller.onSubmit({ preventDefault() {} });
  runtime.controller.onMessage({
    origin: 'https://n-abc123-script.googleusercontent.com',
    data: {
      ok: true,
      channel: 'intersacks-enquiry',
      reference: 'ISD-20261110-0002',
      customerEmail: 'failed',
      submissionKey: '22222222-2222-4222-8222-222222222222',
      status: 'RECEIVED'
    }
  });
  assert.equal(runtime.form.resetCount, 0);
  assert.match(runtime.form.status.textContent, /ISD-20261110-0002/);
  assert.match(runtime.form.status.textContent, /could not send the email/i);
  assert.match(runtime.form.status.textContent, /not a confirmed booking/i);
  assert.equal(runtime.form.status.classList.contains('is-success'), false);
});

test('success without an enquiry reference is rejected', () => {
  const runtime = loadController();
  runtime.controller.onSubmit({ preventDefault() {} });
  runtime.controller.onMessage({
    origin: 'https://n-abc123-script.googleusercontent.com',
    data: { ok: true, channel: 'intersacks-enquiry', reference: '', status: 'RECEIVED' }
  });
  assert.equal(runtime.form.resetCount, 0);
  assert.equal(runtime.form.status.classList.contains('is-success'), false);
  assert.match(runtime.form.status.textContent, /could not send/i);
});

test('an iframe load or opaque response is not treated as success', () => {
  const runtime = loadController();
  runtime.controller.onSubmit({ preventDefault() {} });
  runtime.controller.onMessage({ origin: 'https://evil.example', data: { ok: true, reference: 'ISD-20261110-0001', channel: 'intersacks-enquiry' } });
  runtime.controller.onMessage({ origin: 'https://n-abc123-script.googleusercontent.com', data: { ok: true, channel: 'other', reference: 'ISD-20261110-0001' } });
  assert.equal(runtime.form.resetCount, 0);
  assert.equal(runtime.form.status.classList.contains('is-success'), false);
});

test('a timeout is a failure, not a successful save', () => {
  const runtime = loadController();
  runtime.controller.onSubmit({ preventDefault() {} });
  assert.equal(runtime.timers.length, 1);
  runtime.timers[0].fn();
  assert.match(runtime.form.status.textContent, /could not send/i);
  assert.equal(runtime.form.status.classList.contains('is-success'), false);
  assert.equal(runtime.form.resetCount, 0);
});

test('missing name is caught before submit', () => {
  const runtime = loadController({ values: { name: '' } });
  runtime.controller.onSubmit({ preventDefault() {} });
  assert.equal(runtime.form.submitCount, 0);
  assert.match(runtime.form.status.textContent, /full name/i);
});

test('missing phone is caught before submit', () => {
  const runtime = loadController({ values: { phone: '' } });
  runtime.controller.onSubmit({ preventDefault() {} });
  assert.equal(runtime.form.submitCount, 0);
  assert.match(runtime.form.status.textContent, /phone/i);
});

test('script.js keeps the mailto recipient and does not embed Apps Script', () => {
  assert.match(scriptSource, /mailto:lesleysacks1@gmail.com\?subject=/);
  assert.equal(/script\.google|spreadsheet/i.test(scriptSource), false);
  assert.equal(/no-cors/i.test(source), false);
  assert.equal(/fetch\s*\(/.test(source), false);
});

test('Apps Script source has no onFormSubmit and no extra backend', () => {
  assert.equal(/\bfunction\s+onFormSubmit\b/.test(appsScript), false);
  assert.equal(/firebase|supabase|django|flask/i.test(appsScript), false);
  assert.match(appsScript, /function doPost\s*\(/);
  assert.match(appsScript, /function processEnquiry\s*\(/);
  assert.match(appsScript, /function sendWhatsAppNotification\s*\(/);
  assert.match(appsScript, /WHATSAPP_ENABLED/);
});
