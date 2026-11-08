import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const source = readFileSync(fileURLToPath(new URL('../../js/enquiry-form.js', import.meta.url)), 'utf8');
const SUCCESS = 'Thank you. Your enquiry has been received. We will contact you about it.';
const FAILURE = 'We could not send your enquiry. Please try again, or email lesleysacks1@gmail.com or call 084 325 2262.';

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
    consent: true,
    fax_number: '',
    ...initial
  };
  const form = {
    state,
    status: { textContent: '', classList: classList() },
    label: { textContent: 'Send enquiry' },
    spinner: { hidden: true },
    button: null,
    valid: true,
    resetCount: 0,
    attributes: { 'data-enquiry-endpoint': '/api/enquiry', 'aria-busy': 'false' },
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
      state.consent = false;
      state.fax_number = '';
    },
    elements: {
      namedItem: (name) => {
        if (name === 'consent') return { type: 'checkbox', checked: state.consent, value: 'yes' };
        if (!Object.prototype.hasOwnProperty.call(state, name)) return null;
        return { type: 'text', value: state[name] };
      }
    },
    querySelector(selector) {
      if (selector === '#form-status') return this.status;
      if (selector === 'button[type="submit"]') return this.button;
      return null;
    },
    addEventListener(type, listener) { this.listener = { type, listener }; }
  };
  form.button = {
    disabled: false,
    classList: classList(),
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = String(value); },
    querySelector(selector) {
      if (selector === '.button-label') return form.label;
      if (selector === '.form-spinner') return form.spinner;
      return null;
    }
  };
  return form;
}

function boot(form, options = {}) {
  const sandbox = {
    console,
    crypto: { randomUUID: () => options.keys ? options.keys.shift() : '22222222-2222-4222-8222-222222222222' }
  };
  sandbox.window = sandbox;
  runInNewContext(source, sandbox, { filename: 'enquiry-form.js' });
  const calls = [];
  const controller = sandbox.createEnquiryController({
    form,
    pagePath: '/contact.html',
    fetchImpl: options.fetchImpl || (async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 200, json: async () => ({ ok: true, leadId: 'ISD-20261108-0001' }) };
    })
  });
  return { controller, calls };
}

function event() {
  return { preventDefault() { this.prevented = true; }, prevented: false };
}

test('client files do not contain the spreadsheet id or an Apps Script address', () => {
  const files = ['contact.html', 'js/script.js', 'js/enquiry-form.js', 'css/styles.css'].map((file) => (
    readFileSync(fileURLToPath(new URL(`../../${file}`, import.meta.url)), 'utf8')
  )).join('\n');
  assert.equal(/script\.google|1N2xHXT2|ENQUIRY_PROXY_TOKEN|APPS_SCRIPT_ENQUIRY_URL/i.test(files), false);
  assert.equal(files.includes('mailto:lesleysacks1@gmail.com?subject='), false);
});

test('successful submission shows confirmed feedback and resets the form', async () => {
  const form = fakeForm();
  const { controller, calls } = boot(form);
  await controller.onSubmit(event());
  const payload = JSON.parse(calls[0].init.body);
  assert.equal(calls[0].url, '/api/enquiry');
  assert.equal(payload.consent, true);
  assert.equal(payload.page, '/contact.html');
  assert.equal(payload.submissionKey, '22222222-2222-4222-8222-222222222222');
  assert.equal(form.status.textContent, SUCCESS);
  assert.equal(form.status.classList.contains('is-success'), true);
  assert.equal(form.status.classList.contains('is-error'), false);
  assert.equal(form.resetCount, 1);
  assert.equal(form.state.name, '');
  assert.equal(form.button.disabled, false);
  assert.equal(form.button.classList.contains('is-loading'), false);
  assert.equal(form.spinner.hidden, true);
  assert.equal(form.attributes['aria-busy'], 'false');
});

test('missing name, email, service, description, consent and an invalid phone do not submit', async () => {
  const cases = [
    [{ name: '  ' }, 'Enter your full name.'],
    [{ email: 'not-an-email' }, 'Enter a valid email address.'],
    [{ service: '' }, 'Choose the service you need.'],
    [{ message: '' }, 'Describe your project.'],
    [{ consent: false }, 'Agree to be contacted about this enquiry before sending it.'],
    [{ phone: '12345' }, 'Enter a valid South African phone number, or leave the phone field blank.']
  ];
  for (const [overrides, message] of cases) {
    const form = fakeForm(overrides);
    const { controller, calls } = boot(form);
    await controller.onSubmit(event());
    assert.equal(calls.length, 0);
    assert.equal(form.status.textContent, message);
    assert.equal(form.status.classList.contains('is-error'), true);
    assert.equal(form.resetCount, 0);
    assert.equal(form.button.disabled, false);
  }
});

test('backend failure does not show a success message or expose the upstream error', async () => {
  const form = fakeForm();
  const { controller } = boot(form, {
    fetchImpl: async () => ({
      ok: false,
      status: 500,
      json: async () => ({ ok: false, message: 'Exception: spreadsheet 1N2xHXT2t28CdSBkZFihbOxgk9H3kK2-8n0QK2kXrW4M' })
    })
  });
  await controller.onSubmit(event());
  assert.equal(form.status.textContent, FAILURE);
  assert.equal(form.status.textContent.includes('1N2x'), false);
  assert.equal(form.status.classList.contains('is-success'), false);
  assert.equal(form.resetCount, 0);
  assert.equal(form.state.email, 'lesley@example.co.za');
  assert.equal(form.button.disabled, false);
});

test('network failure keeps the form values and the same submission key for a retry', async () => {
  const form = fakeForm();
  const keys = ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'];
  const calls = [];
  let failed = true;
  const sandbox = {
    console,
    crypto: { randomUUID: () => keys.shift() }
  };
  sandbox.window = sandbox;
  runInNewContext(source, sandbox, { filename: 'enquiry-form.js' });
  const controller = sandbox.createEnquiryController({
    form,
    pagePath: '/contact.html',
    fetchImpl: async (url, init) => {
      calls.push(JSON.parse(init.body));
      if (failed) throw new Error('Failed to fetch');
      return { ok: true, status: 200, json: async () => ({ ok: true, leadId: 'ISD-20261108-0003' }) };
    }
  });

  await controller.onSubmit(event());
  await controller.onSubmit(event());
  assert.equal(form.status.textContent, FAILURE);
  assert.equal(form.resetCount, 0);
  assert.equal(calls[0].submissionKey, calls[1].submissionKey);
  assert.equal(form.state.message, 'A new brochure site for the studio.');

  failed = false;
  await controller.onSubmit(event());
  assert.equal(form.status.textContent, SUCCESS);
  assert.equal(calls[2].submissionKey, calls[0].submissionKey);
  assert.equal(form.resetCount, 1);

  calls.length = 0;
  form.state.name = 'Lesley Naidoo';
  form.state.email = 'lesley@example.co.za';
  form.state.service = 'Branding';
  form.state.message = 'Another project.';
  form.state.consent = true;
  await controller.onSubmit(event());
  assert.equal(calls[0].submissionKey, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2');
});

test('a response without a lead id is not treated as a successful save', async () => {
  const form = fakeForm();
  const { controller } = boot(form, {
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) })
  });
  await controller.onSubmit(event());
  assert.equal(form.status.textContent, FAILURE);
  assert.equal(form.resetCount, 0);
});

test('repeated button clicks send one request and show one loading state', async () => {
  const form = fakeForm();
  let resolveFetch;
  let calls = 0;
  const { controller } = boot(form, {
    fetchImpl: () => {
      calls += 1;
      return new Promise((resolve) => { resolveFetch = resolve; });
    }
  });
  const first = controller.onSubmit(event());
  const second = controller.onSubmit(event());
  await Promise.resolve();
  assert.equal(calls, 1);
  assert.equal(form.button.disabled, true);
  assert.equal(form.label.textContent, 'Sending');
  assert.equal(form.spinner.hidden, false);
  assert.equal(form.button.classList.contains('is-loading'), true);
  assert.equal(form.attributes['aria-busy'], 'true');
  assert.equal(form.status.textContent, 'Sending your enquiry.');
  resolveFetch({ ok: true, status: 200, json: async () => ({ ok: true, leadId: 'ISD-20261108-0001' }) });
  await first;
  await second;
  assert.equal(calls, 1);
  assert.equal(form.status.textContent, SUCCESS);
  assert.equal(form.button.disabled, false);
});
