/**
 * Exercises the Apps Script web app in a sandbox.
 * SpreadsheetApp is an in-memory fake. These tests do not call Google
 * and do not read or write the production spreadsheet.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { signEnquiry } from '../../server/enquiry-handler.mjs';

const source = readFileSync(fileURLToPath(new URL('../../apps-script/EnquiryWebApp.gs', import.meta.url)), 'utf8');
const TOKEN = '0123456789abcdef'.repeat(4);
const KEY = '22222222-2222-4222-8222-222222222222';
const SPREADSHEET_ID = '1N2xHXT2t28CdSBkZFihbOxgk9H3kK2-8n0QK2kXrW4M';
const SOURCE = 'Website \u2013 Contact form';

const LEAD_HEADERS = [
  'Lead ID', 'Date received', 'Full name', 'Email address', 'Phone number', 'Company name',
  'Service requested', 'Message / project description', 'Lead source', 'Website page',
  'Consent to contact', 'Lead status', 'Priority', 'Assigned person', 'Last contacted',
  'Follow-up date', 'Internal notes', 'Submission key', 'Duplicate of', 'Phone (normalised)', 'Counted'
];
const ERROR_HEADERS = ['Timestamp', 'Code', 'Stage', 'Lead ID', 'Detail (no personal data)'];

function createSheet(headers, dataRows = [], maxRows = 12) {
  const blank = () => Array.from({ length: headers.length }, () => '');
  const rows = [headers.slice()];
  for (const row of dataRows) {
    const copy = blank();
    row.forEach((value, index) => { copy[index] = value; });
    rows.push(copy);
  }
  while (rows.length < maxRows) rows.push(blank());
  const sheet = {
    rows,
    formats: [],
    writes: [],
    onBeforeSet: null,
    getMaxRows() { return rows.length; },
    getRange(row, column, numRows = 1, numColumns = 1) {
      return {
        getValues() {
          const values = [];
          for (let i = 0; i < numRows; i += 1) {
            const sourceRow = rows[row - 1 + i] || blank();
            const line = [];
            for (let j = 0; j < numColumns; j += 1) {
              const value = sourceRow[column - 1 + j];
              line.push(value === undefined ? '' : value);
            }
            values.push(line);
          }
          return values;
        },
        setValues(input) {
          if (sheet.onBeforeSet) sheet.onBeforeSet({ row, column, numRows, numColumns });
          for (let i = 0; i < numRows; i += 1) {
            const target = rows[row - 1 + i];
            for (let j = 0; j < numColumns; j += 1) target[column - 1 + j] = input[i][j];
          }
          sheet.writes.push({ row, column, numRows, numColumns });
        },
        setNumberFormat(format) {
          sheet.formats.push({ row, column, format });
        },
        setFormula(formula) {
          const match = /^="([\s\S]*)"$/.exec(formula);
          rows[row - 1][column - 1] = match ? match[1].replace(/""/g, '"') : formula;
        }
      };
    }
  };
  return sheet;
}

function createLock() {
  const lock = {
    held: false,
    attempts: 0,
    tryLock() {
      lock.attempts += 1;
      if (lock.held) return false;
      lock.held = true;
      return true;
    },
    releaseLock() { lock.held = false; }
  };
  return lock;
}

function load(options = {}) {
  const leads = options.leads || createSheet(options.leadHeaders || LEAD_HEADERS, options.leadRows || []);
  if (options.countedFormula !== false && leads.rows[1]) {
    if (!options.leadRows) leads.rows[1][20] = '=ARRAYFORMULA(IF(A2:A="","",1))';
  }
  const errorLog = options.errorLog || createSheet(options.errorHeaders || ERROR_HEADERS);
  const sheets = {};
  if (!options.omitLeads) sheets.Leads = leads;
  if (!options.omitErrorLog) sheets['Error Log'] = errorLog;
  const requested = [];
  const lock = options.lock || createLock();
  const userLock = options.userLock || createLock();
  const cacheStore = new Map();
  const logs = [];
  const nonceUnderLock = [];
  let opened = 0;
  const sandbox = {
    console: { log(message) { logs.push(String(message)); } },
    SpreadsheetApp: {
      openById(id) {
        opened += 1;
        assert.equal(id, SPREADSHEET_ID);
        if (options.missingSpreadsheet) throw new Error(`Exception: Document ${id} is missing`);
        return {
          getSheetByName(name) {
            requested.push(name);
            return sheets[name] || null;
          }
        };
      }
    },
    LockService: {
      getScriptLock() { return lock; },
      getUserLock() { return userLock; }
    },
    PropertiesService: {
      getScriptProperties() {
        return {
          getProperty(name) {
            if (name !== 'ENQUIRY_PROXY_TOKEN') return null;
            return options.token === undefined ? TOKEN : options.token;
          }
        };
      }
    },
    CacheService: {
      getScriptCache() {
        if (options.cacheThrows) throw new Error('cache down');
        return {
          get(key) {
            if (options.securityLogThrows && String(key).startsWith('security-log:')) throw new Error('security log cache down');
            if (String(key).startsWith('enquiry-nonce:')) nonceUnderLock.push(lock.held);
            if (options.rateCacheThrows && String(key).startsWith('lead-rate:')) throw new Error('rate cache down');
            return cacheStore.has(key) ? cacheStore.get(key) : null;
          },
          put(key, value) {
            if (options.securityLogThrows && String(key).startsWith('security-log:')) throw new Error('security log cache down');
            if (String(key).startsWith('enquiry-nonce:')) nonceUnderLock.push(lock.held);
            if (options.noncePutDrops && String(key).startsWith('enquiry-nonce:')) return;
            if (options.rateCacheThrows && String(key).startsWith('lead-rate:')) throw new Error('rate cache down');
            cacheStore.set(key, String(value));
          }
        };
      }
    },
    Utilities: {
      formatDate(date, timeZone, pattern) {
        assert.equal(timeZone, 'Africa/Johannesburg');
        assert.equal(pattern, 'yyyyMMdd');
        assert.equal(Object.prototype.toString.call(date), '[object Date]');
        return options.stamp || '20261108';
      },
      getUuid() { return '11111111-1111-4111-8111-111111111111'; },
      computeHmacSha256Signature(message, secret) {
        const digest = crypto.createHmac('sha256', secret).update(String(message)).digest();
        return Array.from(digest, (byte) => (byte > 127 ? byte - 256 : byte));
      }
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput(text) {
        const output = { text, mime: '' };
        output.setMimeType = (mime) => { output.mime = mime; return output; };
        return output;
      }
    }
  };
  runInNewContext(source, sandbox, { filename: 'EnquiryWebApp.gs' });
  return {
    doPost: sandbox.doPost,
    doGet: sandbox.doGet,
    logError_: sandbox.logError_,
    safeDetail_: sandbox.safeDetail_,
    leads,
    errorLog,
    lock,
    userLock,
    requested,
    cacheStore,
    logs,
    nonceUnderLock,
    opened: () => opened
  };
}

function validBody(overrides = {}) {
  return {
    token: TOKEN,
    name: 'Lesley Naidoo',
    email: 'lesley@example.co.za',
    business: 'Naidoo Studio',
    phone: '084 325 2262',
    service: 'Web Solutions',
    message: 'A new brochure site for the studio.',
    consent: 'yes',
    page: '/contact.html',
    submissionKey: KEY,
    ...overrides
  };
}

function post(app, body, signing = {}) {
  const fields = { ...body };
  delete fields.token;
  delete fields.timestamp;
  delete fields.nonce;
  delete fields.signature;
  let payload = fields;
  if (!signing.unsigned) {
    const secret = signing.secret === undefined ? TOKEN : signing.secret;
    const signed = signEnquiry(secret, fields, signing);
    payload = {
      ...fields,
      timestamp: signed.timestamp,
      nonce: signed.nonce,
      signature: signing.signature || signed.signature
    };
    if (signing.tamper) {
      payload.signature = (payload.signature[0] === '0' ? '1' : '0') + payload.signature.slice(1);
    }
  }
  const output = app.doPost({ postData: { contents: JSON.stringify(payload), type: 'application/json' } });
  assert.equal(output.mime, 'application/json');
  assert.equal(output.text.includes(SPREADSHEET_ID), false);
  assert.equal(output.text.includes(TOKEN), false);
  assert.equal(output.text.includes('signature'), false);
  return JSON.parse(output.text);
}

function savedLeads(sheet) {
  return sheet.rows.filter((row, index) => index > 0 && String(row[0] || '').startsWith('ISD-'));
}

function errorCodes(sheet) {
  return sheet.rows.slice(1).map((row) => row[1]).filter(Boolean);
}

test('valid enquiry submission writes one lead and leaves Counted to the formula', () => {
  const app = load();
  const countedBefore = app.leads.rows[1][20];
  const result = post(app, validBody());
  const [lead] = savedLeads(app.leads);

  assert.equal(result.ok, true);
  assert.equal(result.duplicate, false);
  assert.equal(result.leadId, 'ISD-20261108-0001');
  assert.deepEqual(lead.slice(0, 20), [
    'ISD-20261108-0001',
    lead[1],
    'Lesley Naidoo',
    'lesley@example.co.za',
    '084 325 2262',
    'Naidoo Studio',
    'Web Solutions',
    'A new brochure site for the studio.',
    SOURCE,
    '/contact.html',
    'Yes',
    'NEW',
    'Medium',
    '',
    '',
    '',
    '',
    KEY,
    '',
    "'+27843252262"
  ]);
  assert.equal(Object.prototype.toString.call(lead[1]), '[object Date]');
  assert.equal(Number.isNaN(lead[1].getTime()), false);
  assert.equal(app.leads.rows[1][20], countedBefore);
  assert.equal(app.leads.writes.some((write) => write.numColumns === 21), false);
  assert.equal(app.leads.formats.some((format) => format.column === 2), false);
  assert.equal(app.leads.formats.some((format) => format.column === 20 && format.format === '@'), true);
  assert.deepEqual(app.requested, ['Leads']);
  assert.deepEqual(errorCodes(app.errorLog), []);
  assert.deepEqual(app.leads.rows[0], LEAD_HEADERS);
});

test('missing name, email, service, description and consent are rejected before a row is written', () => {
  const cases = [
    [{ name: '   ' }, 'Enter your full name.', 'Name was missing.'],
    [{ email: 'not-an-email' }, 'Enter a valid email address.', 'Email was missing or invalid.'],
    [{ service: '' }, 'Choose the service you need.', 'Service was missing or unknown.'],
    [{ message: '   ' }, 'Describe your project.', 'Project description was missing.'],
    [{ consent: '' }, 'Agree to be contacted about this enquiry before sending it.', 'Consent was missing.']
  ];
  for (const [overrides, message, detail] of cases) {
    const app = load();
    const result = post(app, validBody(overrides));
    assert.equal(result.ok, false);
    assert.equal(result.code, 'VALIDATION');
    assert.equal(result.message, message);
    assert.equal(savedLeads(app.leads).length, 0);
    assert.equal(app.errorLog.rows[1][4], detail);
    assert.equal(String(app.errorLog.rows[1][4]).includes('@'), false);
    assert.deepEqual(app.errorLog.rows[0], ERROR_HEADERS);
  }
});

test('invalid phone numbers are rejected and valid South African numbers are normalised', () => {
  for (const phone of ['12345', '084325', '+1 202 555 0143', 'call me', '084 325 2262 ext 9']) {
    const app = load();
    const result = post(app, validBody({ phone }));
    assert.equal(result.ok, false, phone);
    assert.equal(result.message, 'Enter a valid South African phone number, or leave the phone field blank.');
    assert.equal(savedLeads(app.leads).length, 0);
  }

  const accepted = {
    '': '',
    '0843252262': "'+27843252262",
    '+27 84 325 2262': "'+27843252262",
    '27843252262': "'+27843252262",
    '084-325-2262': "'+27843252262",
    '(084) 325 2262': "'+27843252262"
  };
  for (const [phone, normalised] of Object.entries(accepted)) {
    const app = load();
    const result = post(app, validBody({ phone }));
    assert.equal(result.ok, true, phone);
    const [lead] = savedLeads(app.leads);
    assert.equal(lead[4], phone);
    assert.equal(lead[19], normalised);
  }
});

test('a duplicate submission key returns the original lead and does not overwrite it', () => {
  const existing = [
    'ISD-20261101-0004', new Date('2026-11-01T08:00:00Z'), 'Original Person', 'original@example.co.za',
    '082 000 0000', 'Original Co', 'Branding', 'Keep this message.', SOURCE, '/contact.html', 'Yes',
    'NEW', 'Medium', '', '', '', '', KEY, '', "'+27820000000", '=ARRAYFORMULA(IF(A2:A="","",1))'
  ];
  const app = load({ leadRows: [existing] });
  const result = post(app, validBody({ message: 'A different project.', email: 'other@example.co.za' }));
  assert.equal(result.ok, true);
  assert.equal(result.duplicate, true);
  assert.equal(result.leadId, 'ISD-20261101-0004');
  assert.equal(savedLeads(app.leads).length, 1);
  assert.equal(app.leads.rows[1][7], 'Keep this message.');
  assert.equal(app.leads.rows[1][3], 'original@example.co.za');
});

test('the same email or phone can submit a second enquiry without being marked as a duplicate', () => {
  const app = load();
  const first = post(app, validBody());
  const second = post(app, validBody({
    submissionKey: '44444444-4444-4444-8444-444444444444',
    message: 'A second, separate project.'
  }));
  const leads = savedLeads(app.leads);
  assert.equal(first.leadId, 'ISD-20261108-0001');
  assert.equal(second.leadId, 'ISD-20261108-0002');
  assert.equal(leads.length, 2);
  assert.equal(leads[0][18], '');
  assert.equal(leads[1][18], '');
  assert.equal(leads[1][3], 'lesley@example.co.za');
  assert.equal(leads[1][4], '084 325 2262');
});

test('concurrent submissions wait on the lock and receive different lead ids', () => {
  const app = load();
  let nested = null;
  app.leads.onBeforeSet = (call) => {
    if (nested || call.numColumns !== 20) return;
    nested = post(app, validBody({
      submissionKey: '55555555-5555-4555-8555-555555555555',
      email: 'second@example.co.za',
      name: 'Second Client'
    }));
  };
  const first = post(app, validBody());
  assert.equal(first.ok, true);
  assert.equal(nested.ok, false);
  assert.equal(nested.code, 'LOCKED');
  assert.equal(savedLeads(app.leads).length, 1);

  const third = post(app, validBody({
    submissionKey: '55555555-5555-4555-8555-555555555555',
    email: 'second@example.co.za',
    name: 'Second Client'
  }));
  const leads = savedLeads(app.leads);
  assert.equal(third.ok, true);
  assert.equal(leads[0][0], 'ISD-20261108-0001');
  assert.equal(leads[1][0], 'ISD-20261108-0002');
  assert.notEqual(leads[0][0], leads[1][0]);
});

test('a held lock rejects the enquiry without writing a lead', () => {
  const lock = createLock();
  assert.equal(lock.tryLock(), true);
  const app = load({ lock });
  const result = post(app, validBody());
  assert.equal(result.code, 'LOCKED');
  assert.equal(savedLeads(app.leads).length, 0);
});

test('a missing spreadsheet returns a safe error and does not throw', () => {
  const app = load({ missingSpreadsheet: true });
  const result = post(app, validBody());
  assert.equal(result.ok, false);
  assert.equal(result.code, 'SPREADSHEET_UNAVAILABLE');
  assert.equal(result.message.includes(SPREADSHEET_ID), false);
  assert.equal(result.message.toLowerCase().includes('exception'), false);
});

test('a missing Leads sheet is logged on the Error Log and does not throw', () => {
  const app = load({ omitLeads: true });
  const result = post(app, validBody());
  assert.equal(result.code, 'SHEET_MISSING');
  assert.equal(app.errorLog.rows[1][1], 'SHEET_MISSING');
  assert.equal(app.errorLog.rows[1][4], 'The Leads sheet is missing.');
  assert.equal(JSON.stringify(app.errorLog.rows).includes('lesley@example.co.za'), false);
  assert.equal(app.requested.includes('Dashboard'), false);
  assert.equal(app.requested.includes('Lists'), false);
});

test('an Error Log with unexpected headers is left untouched', () => {
  const errorLog = createSheet(['When', 'What']);
  const app = load({ omitLeads: true, errorLog });
  const before = JSON.stringify(errorLog.rows);
  const result = post(app, validBody());
  assert.equal(result.code, 'SHEET_MISSING');
  assert.equal(JSON.stringify(errorLog.rows), before);
});

test('a Leads header mismatch does not write a lead or rename columns', () => {
  const headers = LEAD_HEADERS.slice();
  headers[2] = 'Client';
  const app = load({ leadHeaders: headers });
  const result = post(app, validBody());
  assert.equal(result.code, 'HEADER_MISMATCH');
  assert.equal(savedLeads(app.leads).length, 0);
  assert.equal(app.leads.rows[0][2], 'Client');
});

test('lead ids continue from the highest existing sequence', () => {
  const app = load({
    leadRows: [[
      'ISD-20260101-0007', new Date(), 'Earlier', 'earlier@example.co.za', '', '', 'Branding',
      'Earlier work.', SOURCE, '/contact.html', 'Yes', 'NEW', 'Medium', '', '', '', '',
      '66666666-6666-4666-8666-666666666666', '', ''
    ]]
  });
  const result = post(app, validBody());
  assert.equal(result.leadId, 'ISD-20261108-0008');
  assert.equal(app.leads.rows[1][2], 'Earlier');
});

test('values that could become formulas are stored as text', () => {
  const app = load();
  const result = post(app, validBody({
    name: '=HYPERLINK("https://example.com")',
    message: '+follow up please',
    business: '@studio'
  }));
  assert.equal(result.ok, true);
  const [lead] = savedLeads(app.leads);
  assert.equal(lead[2].startsWith("'="), true);
  assert.equal(lead[5].startsWith("'@"), true);
  assert.equal(lead[7].startsWith("'+"), true);
});

test('missing authentication configuration cannot write to the Error Log', () => {
  const missing = load({ token: '' });
  assert.equal(post(missing, validBody()).code, 'CONFIG');
  assert.equal(savedLeads(missing.leads).length, 0);
  assert.equal(missing.opened(), 0);
  assert.deepEqual(errorCodes(missing.errorLog), []);
  assert.deepEqual(missing.logs, ['Unauthenticated enquiry rejected: CONFIG']);

  const short = load({ token: 'a'.repeat(63) });
  assert.equal(post(short, validBody()).code, 'CONFIG');
  assert.equal(short.opened(), 0);
  assert.deepEqual(errorCodes(short.errorLog), []);
});

test('invalid signatures cannot write to the Error Log', () => {
  const wrong = load();
  assert.equal(post(wrong, validBody(), { secret: 'fedcba9876543210'.repeat(4) }).code, 'UNAUTHORISED');
  assert.equal(post(wrong, validBody(), { tamper: true }).code, 'UNAUTHORISED');
  assert.equal(post(wrong, validBody(), { unsigned: true }).code, 'UNAUTHORISED');
  assert.equal(savedLeads(wrong.leads).length, 0);
  assert.equal(wrong.opened(), 0);
  assert.deepEqual(errorCodes(wrong.errorLog), []);
  assert.deepEqual(wrong.logs, ['Unauthenticated enquiry rejected: UNAUTHORISED']);
});

test('boolean consent from the browser still verifies', () => {
  const app = load();
  const result = post(app, validBody({ consent: true }));
  assert.equal(result.ok, true);
  assert.equal(savedLeads(app.leads)[0][10], 'Yes');
});

test('expired signatures cannot write to the Error Log', () => {
  const app = load();
  const past = Math.floor(Date.now() / 1000) - 301;
  const future = Math.floor(Date.now() / 1000) + 301;
  assert.equal(post(app, validBody(), { timestamp: past }).code, 'EXPIRED');
  assert.equal(post(app, validBody(), { timestamp: future, nonce: 'ffffffffffffffff' }).code, 'EXPIRED');
  assert.equal(savedLeads(app.leads).length, 0);
  assert.equal(app.opened(), 0);
  assert.deepEqual(errorCodes(app.errorLog), []);
  assert.deepEqual(app.logs, ['Unauthenticated enquiry rejected: EXPIRED']);
});

test('a replayed nonce is rejected after the first accepted request', () => {
  const app = load();
  const nonce = 'replayed-nonce-0001';
  const timestamp = Math.floor(Date.now() / 1000);
  const first = post(app, validBody(), { nonce, timestamp });
  const second = post(app, validBody(), { nonce, timestamp });
  assert.equal(first.ok, true);
  assert.equal(first.leadId, 'ISD-20261108-0001');
  assert.equal(second.ok, false);
  assert.equal(second.code, 'REPLAY');
  assert.equal(savedLeads(app.leads).length, 1);
  assert.equal(app.cacheStore.get('enquiry-nonce:' + nonce), '1');
  assert.equal(app.nonceUnderLock.length > 0, true);
  assert.equal(app.nonceUnderLock.every(Boolean), true);
});

test('repeated replay attempts do not flood the Error Log', () => {
  const app = load();
  const nonce = 'replayed-nonce-0002';
  const timestamp = Math.floor(Date.now() / 1000);
  const first = post(app, validBody(), { nonce, timestamp });
  assert.equal(first.ok, true);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const again = post(app, validBody(), { nonce, timestamp });
    assert.equal(again.ok, false);
    assert.equal(again.code, 'REPLAY');
  }
  assert.equal(savedLeads(app.leads).length, 1);
  assert.deepEqual(errorCodes(app.errorLog), ['REPLAY']);
  assert.equal(JSON.stringify(app.errorLog.rows).includes('lesley@example.co.za'), false);
});

test('a replay is still rejected when security logging cannot be throttled', () => {
  const app = load({ securityLogThrows: true });
  const nonce = 'replayed-nonce-0003';
  const timestamp = Math.floor(Date.now() / 1000);
  const first = post(app, validBody(), { nonce, timestamp });
  const again = post(app, validBody(), { nonce, timestamp });
  assert.equal(first.ok, true);
  assert.equal(again.code, 'REPLAY');
  assert.equal(savedLeads(app.leads).length, 1);
  assert.deepEqual(errorCodes(app.errorLog), []);
  assert.equal(app.logs.includes('Enquiry security log suppressed: REPLAY'), true);
});

test('a logging failure does not accept a replayed enquiry', () => {
  const userLock = createLock();
  userLock.tryLock = () => { throw new Error('user lock unavailable'); };
  const app = load({ userLock });
  const nonce = 'replayed-nonce-0004';
  const timestamp = Math.floor(Date.now() / 1000);
  const first = post(app, validBody(), { nonce, timestamp });
  const again = post(app, validBody(), { nonce, timestamp });
  assert.equal(first.ok, true);
  assert.equal(again.code, 'REPLAY');
  assert.equal(savedLeads(app.leads).length, 1);
  assert.deepEqual(errorCodes(app.errorLog), []);
});

test('concurrent Error Log writes do not overwrite one another', () => {
  const app = load();
  let nested = false;
  app.errorLog.onBeforeSet = () => {
    if (nested) return;
    nested = true;
    assert.equal(app.userLock.held, true);
    app.logError_('SHEET_MISSING', 'leads', '', 'The Leads sheet is missing.');
    assert.equal(app.errorLog.rows[1][1], '');
  };
  app.logError_('HEADER_MISMATCH', 'headers', '', 'The Leads header row does not match the expected schema.');
  assert.equal(app.errorLog.rows[1][1], 'HEADER_MISMATCH');
  assert.equal(app.errorLog.rows[1][4], 'The Leads header row does not match the expected schema.');
  assert.equal(app.userLock.held, false);
  app.logError_('SHEET_FULL', 'write', 'ISD-20261108-0001', 'The Leads sheet has no empty row.');
  assert.equal(app.errorLog.rows[1][1], 'HEADER_MISMATCH');
  assert.equal(app.errorLog.rows[2][1], 'SHEET_FULL');
  assert.deepEqual(app.errorLog.rows[0], ERROR_HEADERS);
});

test('nonce cache failure fails closed', () => {
  const unavailable = load({ cacheThrows: true });
  const blocked = post(unavailable, validBody());
  assert.equal(blocked.code, 'AUTH_UNAVAILABLE');
  assert.equal(savedLeads(unavailable.leads).length, 0);

  const dropped = load({ noncePutDrops: true });
  const unstored = post(dropped, validBody());
  assert.equal(unstored.code, 'AUTH_UNAVAILABLE');
  assert.equal(savedLeads(dropped.leads).length, 0);
  assert.equal(dropped.nonceUnderLock.length > 0, true);
  assert.equal(dropped.nonceUnderLock.every(Boolean), true);
});

test('an email rate-limit cache failure still saves the lead', () => {
  const app = load({ rateCacheThrows: true });
  const result = post(app, validBody());
  assert.equal(result.ok, true);
  assert.equal(result.leadId, 'ISD-20261108-0001');
  assert.equal(savedLeads(app.leads).length, 1);
  assert.deepEqual(errorCodes(app.errorLog), []);
});

test('an omitted submission key is generated and an invalid key is rejected', () => {
  const generated = load();
  const body = validBody();
  delete body.submissionKey;
  const result = post(generated, body);
  assert.equal(result.ok, true);
  assert.equal(savedLeads(generated.leads)[0][17], '11111111-1111-4111-8111-111111111111');

  const invalid = load();
  const rejected = post(invalid, validBody({ submissionKey: 'not-a-uuid' }));
  assert.equal(rejected.code, 'VALIDATION');
  assert.equal(savedLeads(invalid.leads).length, 0);
});

test('invalid JSON cannot write to the Error Log', () => {
  const app = load();
  const malformed = JSON.parse(app.doPost({ postData: { contents: '{', type: 'application/json' } }).text);
  const arrayBody = JSON.parse(app.doPost({ postData: { contents: '[]', type: 'application/json' } }).text);
  assert.equal(malformed.code, 'VALIDATION');
  assert.equal(arrayBody.code, 'VALIDATION');
  assert.equal(JSON.parse(app.doGet().text).code, 'METHOD_NOT_ALLOWED');
  assert.equal(savedLeads(app.leads).length, 0);
  assert.equal(app.opened(), 0);
  assert.deepEqual(errorCodes(app.errorLog), []);
  assert.deepEqual(app.logs, ['Unauthenticated enquiry rejected: INVALID_JSON']);
});

test('authenticated spreadsheet errors still log safely', () => {
  const missingSheet = load({ omitLeads: true });
  const missing = post(missingSheet, validBody());
  assert.equal(missing.code, 'SHEET_MISSING');
  assert.deepEqual(missingSheet.errorLog.rows[0], ERROR_HEADERS);
  assert.equal(missingSheet.errorLog.rows[1][1], 'SHEET_MISSING');
  assert.equal(missingSheet.errorLog.rows[1][2], 'leads');
  assert.equal(JSON.stringify(missingSheet.errorLog.rows).includes('lesley@example.co.za'), false);
  assert.equal(JSON.stringify(missingSheet.errorLog.rows).includes(SPREADSHEET_ID), false);

  const missingBook = load({ missingSpreadsheet: true });
  const blocked = post(missingBook, validBody());
  assert.equal(blocked.code, 'SPREADSHEET_UNAVAILABLE');
  assert.equal(blocked.message.includes(SPREADSHEET_ID), false);
  assert.deepEqual(errorCodes(missingBook.errorLog), []);
  assert.equal(missingBook.logs.includes('Enquiry error log was not written.'), true);
  assert.equal(missingBook.logs.some((line) => line.includes(SPREADSHEET_ID)), false);
});

test('error details redact personal data and the spreadsheet id', () => {
  const app = load();
  const detail = app.safeDetail_(`Failed for lesley@example.co.za on 084 325 2262 at ${SPREADSHEET_ID}`);
  assert.equal(detail.includes('lesley@example.co.za'), false);
  assert.equal(detail.includes('084'), false);
  assert.equal(detail.includes(SPREADSHEET_ID), false);
  assert.equal(detail.includes('[redacted]'), true);
});
