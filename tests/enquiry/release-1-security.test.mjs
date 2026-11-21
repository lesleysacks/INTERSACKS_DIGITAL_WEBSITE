/**
 * Release 1 security and regression tests for the Apps Script enquiry
 * backend. All Google services are in-memory fakes (see
 * helpers/apps-script-sandbox.mjs). These tests are not a production
 * integration test and do not send email.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { enquiry, load, post, formPost, savedRows, uniqueKey, SPREADSHEET_ID } from './helpers/apps-script-sandbox.mjs';

const SAFE_MESSAGE = /^[A-Za-z0-9 ,.'’\-()]{8,200}$/; // the contact page only shows messages that match this

test('a valid Release 1 enquiry saves one row, notifies the owner first, then the customer', () => {
  const runtime = load();
  const result = post(runtime, enquiry());
  assert.equal(result.ok, true);
  assert.match(result.reference, /^ISD-\d{8}-\d{4}$/);
  const rows = savedRows(runtime.leads);
  assert.equal(rows.length, 1);
  assert.equal(rows[0][11], 'NEW');
  assert.deepEqual(runtime.mail.sent.map((mail) => mail.to), ['owner@example.co.za', 'thandi@example.co.za']);
  assert.match(rows[0][16], /customer=sent; owner=sent/);
});

test('consent is not recorded as an automatic Yes', () => {
  const runtime = load();
  post(runtime, enquiry());
  const row = savedRows(runtime.leads)[0];
  assert.notEqual(row[10], 'Yes');
  assert.equal(row[10], 'Reply to enquiry only (visitor request)');
  assert.match(row[16], /Privacy notice 2026-11-21 shown on form/);
  assert.match(row[16], /Submitted \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  assert.match(row[16], /Purpose: reply to this enquiry/);
  assert.match(row[16], /Marketing opt-in: no/);
});

test('only the exact checkbox value "yes" records a marketing opt-in', () => {
  for (const [value, expected] of [['yes', true], ['YES', true], ['on', false], ['true', false], ['1', false], ['', false], [undefined, false]]) {
    const runtime = load();
    const payload = enquiry();
    if (value !== undefined) payload.marketingConsent = value;
    post(runtime, payload);
    const row = savedRows(runtime.leads)[0];
    assert.equal(row[10], expected ? 'Reply to enquiry + marketing opt-in' : 'Reply to enquiry only (visitor request)', String(value));
    assert.match(row[16], expected ? /Marketing opt-in: yes/ : /Marketing opt-in: no/);
  }
});

test('marketing choice is not required to send an enquiry', () => {
  const runtime = load();
  const payload = enquiry();
  delete payload.marketingConsent;
  assert.equal(post(runtime, payload).ok, true);
});

test('invalid and multi-recipient email addresses are rejected before anything is saved or sent', () => {
  const bad = [
    'not-an-email',
    'a@b',
    'a..b@example.com',
    '.a@example.com',
    'a@example.com,victim@example.com',
    'a@example.com;victim@example.com',
    'victim@example.com, a@example.com',
    'Name <a@example.com>',
    '"a b"@example.com',
    'a@example.com\r\nBcc: victim@example.com',
    'a@example.com\nBcc: victim@example.com',
    'a@-example.com',
    'a@example.c',
    'ａ@example.com',
    'a@exam_ple.com',
    `${'x'.repeat(65)}@example.com`,
    `a@${'b'.repeat(250)}.com`
  ];
  for (const email of bad) {
    const runtime = load();
    const result = post(runtime, enquiry({ email }));
    assert.equal(result.ok, false, email);
    assert.equal(result.code, 'VALIDATION', email);
    assert.equal(savedRows(runtime.leads).length, 0, email);
    assert.equal(runtime.mail.sent.length, 0, email);
  }
});

test('each required field is validated on the server', () => {
  for (const [field, message] of [['name', /full name/i], ['email', /email/i], ['phone', /phone/i], ['service', /service/i], ['message', /describe/i]]) {
    const runtime = load();
    const result = post(runtime, enquiry({ [field]: '' }));
    assert.equal(result.ok, false, field);
    assert.match(result.message, message, field);
    assert.equal(savedRows(runtime.leads).length, 0, field);
  }
  const whitespace = load();
  assert.equal(post(whitespace, enquiry({ name: ' ​‮ ' })).ok, false);
});

test('non-text values (objects, arrays of objects) are not accepted as field values', () => {
  const runtime = load();
  const result = post(runtime, enquiry({ name: { first: 'A' }, message: ['x'] }));
  assert.equal(result.ok, false);
  assert.match(result.message, /full name/i);
});

test('excessively long fields are truncated and an oversized request is rejected', () => {
  const runtime = load();
  const result = post(runtime, enquiry({ name: 'A'.repeat(500), business: 'B'.repeat(500), message: 'M'.repeat(9000) }));
  assert.equal(result.ok, true);
  const row = savedRows(runtime.leads)[0];
  assert.equal(row[2].length, 120);
  assert.equal(row[5].length, 160);
  assert.equal(row[7].length, 4000);

  const huge = load();
  const tooBig = post(huge, enquiry({ message: 'M'.repeat(25000) }));
  assert.equal(tooBig.ok, false);
  assert.equal(tooBig.code, 'VALIDATION');
  assert.equal(savedRows(huge.leads).length, 0);

  const params = load();
  const output = JSON.parse(formPost(params, enquiry({ message: 'M'.repeat(25000) })).getContent());
  assert.equal(output.ok, false);
  assert.equal(savedRows(params.leads).length, 0);
});

test('unexpected fields are ignored and cannot change status, recipients or consent', () => {
  const runtime = load();
  const result = post(runtime, enquiry({
    status: 'CONFIRMED',
    to: 'attacker@evil.example',
    cc: 'attacker@evil.example',
    bcc: 'attacker@evil.example',
    replyTo: 'attacker@evil.example',
    ownerEmail: 'attacker@evil.example',
    OWNER_EMAIL: 'attacker@evil.example',
    consent: 'Yes',
    'Consent to contact': 'Yes',
    bookingDetails: 'Visit http://evil.example',
    __proto__: { polluted: true }
  }));
  assert.equal(result.ok, true);
  const row = savedRows(runtime.leads)[0];
  assert.equal(row[11], 'NEW');
  assert.equal(row[10], 'Reply to enquiry only (visitor request)');
  assert.equal(JSON.stringify(row).includes('evil.example'), false);
  const mailText = JSON.stringify(runtime.mail.sent);
  assert.equal(mailText.includes('attacker@evil.example'), false);
  assert.equal(mailText.includes('evil.example'), false);
  assert.deepEqual(runtime.mail.sent.map((mail) => mail.to).sort(), ['owner@example.co.za', 'thandi@example.co.za']);
  for (const mail of runtime.mail.sent) {
    assert.equal('cc' in mail || 'bcc' in mail, false);
  }
});

test('the customer acknowledgement goes only to the validated enquiry address with a fixed template', () => {
  const runtime = load();
  post(runtime, enquiry({ name: 'Buy cheap pills at http://spam.example', message: 'Visit http://spam.example now' }));
  const customer = runtime.mail.sent.find((mail) => mail.to === 'thandi@example.co.za');
  assert.ok(customer);
  assert.match(customer.body, /^Hello,/);
  assert.equal(customer.body.includes('spam.example'), false);
  assert.equal(customer.htmlBody.includes('spam.example'), false);
  assert.equal(customer.subject.includes('spam'), false);
  assert.equal(customer.replyTo, 'lesleysacks1@gmail.com');

  const named = load();
  post(named, enquiry({ name: "Zoë O’Neil-Smith" }));
  const greeting = named.mail.sent.find((mail) => mail.to === 'thandi@example.co.za');
  assert.match(greeting.body, /^Hello Zoë O’Neil-Smith,/);
});

test('a repeated submission key returns the original reference without new rows or emails', () => {
  const runtime = load();
  const payload = enquiry();
  const first = post(runtime, payload);
  const second = post(runtime, payload);
  const third = post(runtime, { ...payload, name: 'Different Name' });
  assert.equal(second.reference, first.reference);
  assert.equal(third.reference, first.reference);
  assert.equal(second.duplicate, true);
  assert.equal(savedRows(runtime.leads).length, 1);
  assert.equal(runtime.mail.sent.length, 2);
});

test('the same enquiry resent with a new key is saved as a repeat, excluded from counts, without a second acknowledgement', () => {
  const runtime = load();
  const first = post(runtime, enquiry());
  const second = post(runtime, enquiry());
  const third = post(runtime, enquiry());
  assert.equal(second.ok, true);
  assert.notEqual(second.reference, first.reference);
  const rows = savedRows(runtime.leads);
  assert.equal(rows.length, 3);
  assert.equal(rows[1][18], first.reference);
  assert.equal(rows[2][18], first.reference);
  assert.match(rows[1][16], /Repeat of ISD-/);
  assert.match(rows[1][16], /customer=skipped:repeat; owner=sent/);
  const customerMails = runtime.mail.sent.filter((mail) => mail.to === 'thandi@example.co.za');
  assert.equal(customerMails.length, 1);
  const ownerMails = runtime.mail.sent.filter((mail) => mail.to === 'owner@example.co.za');
  assert.equal(ownerMails.length, 3);
  assert.match(ownerMails[1].body, /Repeat of earlier enquiry: ISD-/);

  const different = post(runtime, enquiry({ message: 'A completely different request.' }));
  assert.equal(savedRows(runtime.leads)[3][18], '');
  assert.equal(different.ok, true);
});

test('per-email rate limit applies even when the phone number changes', () => {
  const runtime = load();
  const results = [];
  for (let i = 0; i < 6; i += 1) {
    results.push(post(runtime, enquiry({ phone: `082 555 01${String(10 + i)}`, message: `Request number ${i}` })));
  }
  assert.equal(results.slice(0, 5).every((result) => result.ok), true);
  assert.equal(results[5].ok, false);
  assert.equal(results[5].code, 'RATE_LIMIT');
  assert.equal(savedRows(runtime.leads).length, 5);
});

test('per-phone rate limit applies when the attacker rotates email addresses', () => {
  const runtime = load();
  const results = [];
  for (let i = 0; i < 6; i += 1) {
    results.push(post(runtime, enquiry({ email: `rotate${i}@example.com`, message: `Request number ${i}` })));
  }
  assert.equal(results[5].ok, false);
  assert.equal(results[5].code, 'RATE_LIMIT');
});

test('a global hourly limit applies when both email and phone are rotated', () => {
  const runtime = load({ properties: { GLOBAL_HOURLY_LIMIT: '3' } });
  const results = [];
  for (let i = 0; i < 4; i += 1) {
    results.push(post(runtime, enquiry({ email: `rotate${i}@example.com`, phone: `082 555 02${String(10 + i)}`, message: `Request ${i}` })));
  }
  assert.equal(results.slice(0, 3).every((result) => result.ok), true);
  assert.equal(results[3].ok, false);
  assert.equal(results[3].code, 'RATE_LIMIT');
  assert.match(results[3].message, /084 325 2262/);
  assert.match(results[3].message, SAFE_MESSAGE);
  assert.equal(savedRows(runtime.leads).length, 3);
  const logged = runtime.errorLog.rows.filter((row, index) => index > 0 && row[1] === 'RATE_LIMIT');
  assert.equal(logged.length, 1);
  assert.equal(JSON.stringify(logged).includes('rotate'), false);
  assert.equal(JSON.stringify(logged).includes('082'), false);
});

test('hourly cap on customer acknowledgements protects owner notifications', () => {
  const runtime = load({ properties: { CUSTOMER_EMAIL_HOURLY_LIMIT: '2' } });
  for (let i = 0; i < 3; i += 1) {
    assert.equal(post(runtime, enquiry({ email: `cap${i}@example.com`, phone: `082 555 03${String(10 + i)}`, message: `Request ${i}` })).ok, true);
  }
  const owner = runtime.mail.sent.filter((mail) => mail.to === 'owner@example.co.za');
  const customers = runtime.mail.sent.filter((mail) => mail.to !== 'owner@example.co.za');
  assert.equal(owner.length, 3);
  assert.equal(customers.length, 2);
  assert.match(savedRows(runtime.leads)[2][16], /customer=skipped:limit; owner=sent/);
});

test('a low MailApp quota skips the customer acknowledgement but still notifies the owner', () => {
  const runtime = load({ quota: 15 });
  const result = post(runtime, enquiry());
  assert.equal(result.ok, true);
  assert.deepEqual(runtime.mail.sent.map((mail) => mail.to), ['owner@example.co.za']);
  assert.match(savedRows(runtime.leads)[0][16], /customer=skipped:limit; owner=sent/);
});

test('failed notifications are retried only for failed channels, at most twice', () => {
  const runtime = load({ mailFailTimes: 2 });
  const payload = enquiry();
  const first = post(runtime, payload);
  assert.equal(first.ok, true);
  assert.equal(first.customerEmail, 'failed');
  assert.equal(runtime.mail.sent.length, 0);
  post(runtime, payload);
  assert.equal(runtime.mail.sent.length, 2);
  assert.match(savedRows(runtime.leads)[0][16], /customer=sent; owner=sent/);
  assert.match(savedRows(runtime.leads)[0][16], /Privacy notice 2026-11-21/);
  post(runtime, payload);
  assert.equal(runtime.mail.sent.length, 2);

  const stuck = load({ mailFailTimes: 100 });
  const again = enquiry();
  for (let i = 0; i < 6; i += 1) post(stuck, again);
  assert.equal(stuck.mail.failTimes, 100 - 2 * 3);
});

test('a submission that is too fast, malformed or missing timing (when required) is rejected', () => {
  for (const value of ['500', '', 'abc', '-5000', '1e9', String(25 * 60 * 60 * 1000)]) {
    const runtime = load();
    const result = post(runtime, enquiry({ formElapsedMs: value }));
    assert.equal(result.ok, false, value);
    assert.equal(result.code, 'VALIDATION', value);
    assert.match(result.message, SAFE_MESSAGE);
    assert.equal(savedRows(runtime.leads).length, 0, value);
  }
  const legacy = load();
  const payload = enquiry();
  delete payload.formElapsedMs;
  assert.equal(post(legacy, payload).ok, true);
  assert.match(savedRows(legacy.leads)[0][16], /Form timing: absent/);

  const strict = load({ properties: { REQUIRE_FORM_TIMING: 'true' } });
  assert.equal(post(strict, payload).ok, false);
});

test('honeypot submissions are rejected even when only whitespace-padded', () => {
  const runtime = load();
  assert.equal(post(runtime, enquiry({ fax_number: '  021 555 0000 ' })).ok, false);
  assert.equal(savedRows(runtime.leads).length, 0);
  assert.equal(runtime.mail.sent.length, 0);
});

test('spreadsheet formula injection is neutralised in every free-text column', () => {
  const runtime = load();
  post(runtime, enquiry({
    name: '=IMPORTXML("http://evil.example","//a")',
    business: '+SUM(A1:A9)',
    message: '@cmd|calc',
    email: '=x@example.com'
  }));
  const row = savedRows(runtime.leads)[0];
  assert.equal(row[2].startsWith("'="), true);
  assert.equal(row[5].startsWith("'+"), true);
  assert.equal(row[7].startsWith("'@"), true);
  assert.equal(row[3], "'=x@example.com");

  const second = load();
  post(second, enquiry({ business: '-2+3', message: '\t=1+1' }));
  const row2 = savedRows(second.leads)[0];
  assert.equal(row2[5].startsWith("'-"), true);
  assert.equal(row2[7].startsWith("'="), true);
});

test('HTML and script in enquiry fields are escaped in the owner email and absent from the customer email', () => {
  const runtime = load();
  post(runtime, enquiry({
    name: '<script>alert(1)</script>',
    business: '<b onmouseover=alert(1)>Biz</b>',
    message: '<img src=x onerror=alert(1)> "quoted"'
  }));
  const owner = runtime.mail.sent.find((mail) => mail.to === 'owner@example.co.za');
  const customer = runtime.mail.sent.find((mail) => mail.to === 'thandi@example.co.za');
  assert.equal(/<script|<img|<b /i.test(owner.htmlBody), false);
  assert.match(owner.htmlBody, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(owner.htmlBody, /&lt;img src=x onerror=alert\(1\)&gt; &quot;quoted&quot;/);
  assert.equal(/script|onerror|onmouseover/i.test(customer.htmlBody + customer.body), false);
});

test('control, bidi and zero-width characters are removed and text is NFC-normalised', () => {
  const runtime = load();
  post(runtime, enquiry({
    name: 'Amélie​ ‮Du\u0000pont',
    business: 'Studio⁦X⁩',
    message: 'Line one\u0007\nLine two­'
  }));
  const row = savedRows(runtime.leads)[0];
  assert.equal(row[2], 'Amélie Du pont');
  assert.equal(row[2].normalize('NFC'), row[2]);
  assert.equal(row[5], 'Studio X');
  assert.equal(/[\u0000-\u001F\u007F​‮⁦⁩­]/.test(row.join('')), false);
});

test('visitor-facing errors do not expose internal details', () => {
  const runtime = load({ properties: { SPREADSHEET_ID: SPREADSHEET_ID } });
  runtime.sandbox.SpreadsheetApp.openById = () => { throw new Error('Exception: internal stack detail'); };
  const output = JSON.stringify(post(runtime, enquiry()));
  assert.equal(output.includes('internal'), false);
  assert.equal(output.includes('Exception'), false);
  assert.equal(output.includes(SPREADSHEET_ID), false);
  assert.equal(output.includes('owner@example.co.za'), false);

  const mailDown = load({ mailFailTimes: 5 });
  const result = JSON.stringify(post(mailDown, enquiry()));
  assert.equal(result.includes('too many times'), false);
  assert.equal(result.includes('internal'), false);
});

test('every saved enquiry gets a unique reference', () => {
  const runtime = load({ properties: { GLOBAL_HOURLY_LIMIT: '50' } });
  const references = new Set();
  for (let i = 0; i < 12; i += 1) {
    const result = post(runtime, enquiry({ email: `unique${i}@example.com`, phone: `082 555 04${String(10 + i)}`, message: `Request ${i}` }));
    assert.equal(result.ok, true);
    references.add(result.reference);
  }
  assert.equal(references.size, 12);
});

test('error-log rows and operational logs contain no personal information', () => {
  const runtime = load({ properties: { GLOBAL_HOURLY_LIMIT: '1' } });
  post(runtime, enquiry());
  post(runtime, enquiry({ email: 'second@example.com', phone: '082 555 0999', message: 'Another request' }));
  const logText = JSON.stringify(runtime.errorLog.rows.slice(1)) + JSON.stringify(runtime.logs);
  for (const value of ['thandi', 'second@example.com', '082 555', 'Mokoena', 'interior']) {
    assert.equal(logText.toLowerCase().includes(value.toLowerCase()), false, value);
  }
});

test('the editor self-test covers the Release 1 rules and still writes nothing', () => {
  const runtime = load({ properties: { ENVIRONMENT: 'test' } });
  const results = runtime.sandbox.runSafeSelfTest();
  assert.equal(results.every((item) => item.pass), true, JSON.stringify(results.filter((item) => !item.pass)));
  for (const name of ['address list rejected', 'display name rejected', 'control characters removed', 'link in name not used as greeting', 'marketing defaults to no']) {
    assert.ok(results.some((item) => item.name === name), name);
  }
  assert.equal(savedRows(runtime.leads).length, 0);
  assert.equal(runtime.mail.sent.length, 0);
});

test('a plain URL-encoded form post (as the iframe sends) is parsed with the same allowlist', () => {
  const runtime = load();
  const body = new URLSearchParams({ ...enquiry(), status: 'CONFIRMED', to: 'attacker@evil.example', responseFormat: 'json' }).toString();
  const result = JSON.parse(runtime.sandbox.doPost({ postData: { type: 'application/x-www-form-urlencoded', contents: body } }).getContent());
  assert.equal(result.ok, true);
  assert.equal(savedRows(runtime.leads)[0][11], 'NEW');
  assert.equal(JSON.stringify(runtime.mail.sent).includes('attacker'), false);
});

test('unique keys from the helper are valid submission keys', () => {
  assert.match(uniqueKey(), /^[0-9a-f-]{36}$/);
});
