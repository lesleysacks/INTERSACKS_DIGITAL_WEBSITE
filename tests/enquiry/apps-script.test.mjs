/**
 * Exercises the Apps Script web app in a sandbox.
 * SpreadsheetApp is an in-memory fake. These tests do not call Google
 * and do not read or write the production spreadsheet.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const source = readFileSync(fileURLToPath(new URL('../../apps-script/EnquiryWebApp.gs', import.meta.url)), 'utf8');
const SPREADSHEET_ID = '1N2xHXT2t28CdSBkZFihbOxgk9H3kK2-8n0QK2kXrW4M';
const SOURCE = 'Website \u2013 Contact form';
const KEY = '22222222-2222-4222-8222-222222222222';
const KEY_TWO = '33333333-3333-4333-8333-333333333333';

const LEAD_HEADERS = [
  'Lead ID', 'Date received', 'Full name', 'Email address', 'Phone number', 'Company name',
  'Service requested', 'Message / project description', 'Lead source', 'Website page',
  'Consent to contact', 'Lead status', 'Priority', 'Assigned person', 'Last contacted',
  'Follow-up date', 'Internal notes', 'Submission key', 'Duplicate of', 'Phone (normalised)', 'Counted'
];
const ERROR_HEADERS = ['Timestamp', 'Code', 'Stage', 'Lead ID', 'Detail (no personal data)'];

const validEnquiry = {
  name: 'Lesley Naidoo',
  email: 'customer@example.co.za',
  business: 'Naidoo Studio',
  phone: '084 325 2262',
  service: 'Web Solutions',
  message: 'Please quote a brochure website for the studio.',
  page: '/contact.html',
  submissionKey: KEY
};

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
        },
        setValue(value) {
          rows[row - 1][column - 1] = value;
        }
      };
    }
  };
  return sheet;
}

function createLock(options = {}) {
  const lock = {
    held: false,
    attempts: 0,
    failNext: options.failNext || false,
    tryLock() {
      lock.attempts += 1;
      if (lock.failNext) {
        lock.failNext = false;
        return false;
      }
      if (lock.held) return false;
      lock.held = true;
      return true;
    },
    releaseLock() { lock.held = false; }
  };
  return lock;
}

function jsonPost(payload) {
  return {
    postData: {
      type: 'text/plain;charset=utf-8',
      contents: JSON.stringify(payload)
    }
  };
}

function formPost(payload) {
  return { parameter: { ...payload, responseFormat: 'html' } };
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
  const lock = options.lock || createLock();
  const userLock = options.userLock || createLock();
  const cacheStore = new Map();
  const logs = [];
  const mail = { sent: [], fail: options.mailFail === true };
  const properties = {
    SPREADSHEET_ID: options.spreadsheetId === undefined ? SPREADSHEET_ID : options.spreadsheetId,
    SHEET_NAME: 'Leads',
    OWNER_EMAIL: 'owner@example.co.za',
    ENVIRONMENT: options.environment || 'production',
    WHATSAPP_ENABLED: options.whatsappEnabled || 'false',
    ALLOWED_ORIGINS: 'https://www.intersacks.co.za,https://intersacks.co.za',
    ...options.properties
  };
  let opened = 0;
  const sandbox = {
    Date,
    JSON,
    Object,
    String,
    Number,
    Array,
    Math,
    parseInt,
    isNaN,
    console: { log(message) { logs.push(String(message)); } },
    SpreadsheetApp: {
      openById(id) {
        opened += 1;
        if (options.missingSpreadsheet) throw new Error(`Exception: Document ${id} is missing`);
        assert.equal(id, properties.SPREADSHEET_ID || SPREADSHEET_ID);
        return {
          getSheetByName(name) {
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
            if (!Object.prototype.hasOwnProperty.call(properties, name)) return null;
            return properties[name];
          }
        };
      }
    },
    CacheService: {
      getScriptCache() {
        if (options.cacheThrows) throw new Error('cache down');
        return {
          get(key) { return cacheStore.has(key) ? cacheStore.get(key) : null; },
          put(key, value) { cacheStore.set(key, value); }
        };
      }
    },
    MailApp: {
      sendEmail(opts) {
        if (mail.fail) throw new Error('mail transport down');
        mail.sent.push(opts);
      }
    },
    ContentService: {
      MimeType: { JSON: 'JSON' },
      createTextOutput(text) {
        return {
          text,
          mime: null,
          setMimeType(value) { this.mime = value; return this; },
          getContent() { return this.text; }
        };
      }
    },
    HtmlService: {
      XFrameOptionsMode: { ALLOWALL: 'ALLOWALL' },
      createHtmlOutput(html) {
        return {
          html,
          xframe: null,
          setXFrameOptionsMode(value) { this.xframe = value; return this; },
          getContent() { return this.html; }
        };
      }
    },
    Utilities: {
      getUuid() { return options.uuid || KEY; },
      formatDate(date, timeZone, pattern) {
        const parts = new Intl.DateTimeFormat('en-CA', {
          timeZone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        }).formatToParts(date);
        const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
        if (pattern === 'yyyyMMdd') return `${map.year}${map.month}${map.day}`;
        return `${map.year}-${map.month}-${map.day}`;
      }
    }
  };

  runInNewContext(source, sandbox, { filename: 'EnquiryWebApp.gs' });
  return { sandbox, leads, errorLog, lock, mail, logs, opened, cacheStore };
}

function parseJson(output) {
  return JSON.parse(output.getContent());
}

function leadRows(leads) {
  return leads.rows.filter((row, index) => index > 0 && String(row[0] || '').trim());
}

test('1. valid enquiry submission saves a row and emails both parties', () => {
  const runtime = load();
  const result = parseJson(runtime.sandbox.doPost(jsonPost(validEnquiry)));
  assert.equal(result.ok, true);
  assert.equal(result.status, 'RECEIVED');
  assert.match(result.reference, /^ISD-\d{8}-\d{4}$/);
  assert.match(result.message, /not a confirmed booking/i);

  const rows = leadRows(runtime.leads);
  assert.equal(rows.length, 1);
  assert.equal(rows[0][0], result.reference);
  assert.equal(rows[0][2], 'Lesley Naidoo');
  assert.equal(rows[0][3], 'customer@example.co.za');
  assert.equal(rows[0][4], '084 325 2262');
  assert.equal(rows[0][6], 'Web Solutions');
  assert.equal(rows[0][8], SOURCE);
  assert.equal(rows[0][11], 'NEW');
  assert.equal(rows[0][17], KEY);
  assert.equal(rows[0][20], '=ARRAYFORMULA(IF(A2:A="","",1))');
  assert.equal(runtime.leads.writes.some((write) => write.column === 21), false);

  assert.equal(runtime.mail.sent.length, 2);
  const customer = runtime.mail.sent.find((item) => item.to === 'customer@example.co.za');
  const owner = runtime.mail.sent.find((item) => item.to === 'owner@example.co.za');
  assert.ok(customer);
  assert.ok(owner);
  assert.match(customer.subject, new RegExp(result.reference));
  assert.match(owner.subject, /requires attention/i);
});

test('2. missing customer name is rejected', () => {
  const runtime = load();
  const result = parseJson(runtime.sandbox.doPost(jsonPost({ ...validEnquiry, name: '' })));
  assert.equal(result.ok, false);
  assert.equal(result.code, 'VALIDATION');
  assert.match(result.message, /full name/i);
  assert.equal(leadRows(runtime.leads).length, 0);
  assert.equal(runtime.mail.sent.length, 0);
});

test('3. invalid email is rejected', () => {
  const runtime = load();
  const result = parseJson(runtime.sandbox.doPost(jsonPost({ ...validEnquiry, email: 'not-an-email' })));
  assert.equal(result.ok, false);
  assert.equal(result.code, 'VALIDATION');
  assert.match(result.message, /email/i);
  assert.equal(leadRows(runtime.leads).length, 0);
  assert.equal(runtime.mail.sent.length, 0);
});

test('4. missing phone number is rejected', () => {
  const runtime = load();
  const result = parseJson(runtime.sandbox.doPost(jsonPost({ ...validEnquiry, phone: '' })));
  assert.equal(result.ok, false);
  assert.equal(result.code, 'VALIDATION');
  assert.match(result.message, /phone/i);
  assert.equal(leadRows(runtime.leads).length, 0);
});

test('5. invalid enquiry category is rejected', () => {
  const runtime = load();
  const result = parseJson(runtime.sandbox.doPost(jsonPost({ ...validEnquiry, service: 'Catering' })));
  assert.equal(result.ok, false);
  assert.equal(result.code, 'VALIDATION');
  assert.match(result.message, /service/i);
  assert.equal(leadRows(runtime.leads).length, 0);
});

test('6. duplicate submission returns the original reference and does not add a row', () => {
  const runtime = load();
  const first = parseJson(runtime.sandbox.doPost(jsonPost(validEnquiry)));
  const second = parseJson(runtime.sandbox.doPost(jsonPost(validEnquiry)));
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(second.duplicate, true);
  assert.equal(second.reference, first.reference);
  assert.equal(leadRows(runtime.leads).length, 1);
  assert.equal(runtime.mail.sent.length, 2);
});

test('7. spreadsheet unavailable does not send email', () => {
  const runtime = load({ missingSpreadsheet: true });
  const result = parseJson(runtime.sandbox.doPost(jsonPost(validEnquiry)));
  assert.equal(result.ok, false);
  assert.equal(result.code, 'SPREADSHEET_UNAVAILABLE');
  assert.equal(runtime.mail.sent.length, 0);
});

test('8. email notification failure still keeps the saved enquiry', () => {
  const runtime = load({ mailFail: true });
  const result = parseJson(runtime.sandbox.doPost(jsonPost(validEnquiry)));
  assert.equal(result.ok, true);
  assert.match(result.reference, /^ISD-\d{8}-\d{4}$/);
  assert.equal(leadRows(runtime.leads).length, 1);
  assert.equal(runtime.mail.sent.length, 0);
  assert.match(String(runtime.leads.rows[1][16]), /customer=failed/);
  assert.match(String(runtime.leads.rows[1][16]), /owner=failed/);
  assert.equal(result.customerEmail, 'failed');
  assert.equal(JSON.stringify(result).includes('customer@example.co.za'), false);
});

test('a missing Leads worksheet does not report success', () => {
  const runtime = load({ omitLeads: true });
  const result = parseJson(runtime.sandbox.doPost(jsonPost(validEnquiry)));
  assert.equal(result.ok, false);
  assert.equal(result.code, 'SHEET_MISSING');
  assert.equal(result.reference, undefined);
  assert.equal(runtime.mail.sent.length, 0);
});

test('9. concurrent lock contention does not write a duplicate row', () => {
  const runtime = load({ lock: createLock({ failNext: true }) });
  const result = parseJson(runtime.sandbox.doPost(jsonPost(validEnquiry)));
  assert.equal(result.ok, false);
  assert.equal(result.code, 'LOCKED');
  assert.equal(leadRows(runtime.leads).length, 0);
  assert.equal(runtime.mail.sent.length, 0);
});

test('9b. two different submission keys both save', () => {
  const runtime = load();
  const first = parseJson(runtime.sandbox.doPost(jsonPost(validEnquiry)));
  const second = parseJson(runtime.sandbox.doPost(jsonPost({ ...validEnquiry, submissionKey: KEY_TWO, email: 'second@example.co.za' })));
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.notEqual(first.reference, second.reference);
  assert.equal(leadRows(runtime.leads).length, 2);
});

test('10. enquiry references use ISD-YYYYMMDD-NNNN and increase', () => {
  const runtime = load();
  const first = runtime.sandbox.generateEnquiryReference([[], ['ISD-20260101-0003']], new Date('2026-11-10T10:00:00Z'));
  const second = runtime.sandbox.generateEnquiryReference([[], ['ISD-20260101-0003'], ['ISD-20261110-0004']], new Date('2026-11-10T10:00:00Z'));
  assert.equal(first, 'ISD-20261110-0004');
  assert.equal(second, 'ISD-20261110-0005');
});

test('11. website submissions are RECEIVED/NEW and never CONFIRMED', () => {
  const runtime = load();
  const result = parseJson(runtime.sandbox.doPost(jsonPost({ ...validEnquiry, status: 'CONFIRMED' })));
  assert.equal(result.ok, true);
  assert.equal(result.status, 'RECEIVED');
  assert.equal(leadRows(runtime.leads)[0][11], 'NEW');
  assert.equal(result.status === 'CONFIRMED', false);
});

test('12. customer acknowledgement names the reference and is not a booking confirmation', () => {
  const runtime = load();
  const result = runtime.sandbox.processEnquiry(validEnquiry);
  const email = result.notifications.customer.email;
  assert.match(email.subject, new RegExp(result.reference));
  assert.match(email.body, /thank you/i);
  assert.match(email.body, /received/i);
  assert.match(email.body, new RegExp(result.reference));
  assert.match(email.body, /not a confirmed booking/i);
  assert.match(email.body, /084 325 2262/);
  assert.match(email.body, /lesleysacks1@gmail.com/);
  assert.doesNotMatch(email.body, /confirmed booking and project are complete/i);
  assert.equal(email.body.includes(SPREADSHEET_ID), false);
  assert.equal(email.to, 'customer@example.co.za');
});

test('13. owner notification includes the enquiry details and requires attention', () => {
  const runtime = load();
  const result = runtime.sandbox.processEnquiry(validEnquiry);
  const email = result.notifications.owner.email;
  assert.equal(email.to, 'owner@example.co.za');
  assert.match(email.subject, /requires attention/i);
  assert.match(email.body, new RegExp(result.reference));
  assert.match(email.body, /Lesley Naidoo/);
  assert.match(email.body, /customer@example.co.za/);
  assert.match(email.body, /084 325 2262/);
  assert.match(email.body, /brochure website/);
  assert.match(email.body, /not a confirmed booking/i);
});

test('14. no duplicate spreadsheet rows for the same submission key', () => {
  const runtime = load();
  runtime.sandbox.processEnquiry(validEnquiry);
  runtime.sandbox.processEnquiry(validEnquiry);
  runtime.sandbox.processEnquiry({ ...validEnquiry, name: 'Changed Name' });
  assert.equal(leadRows(runtime.leads).length, 1);
  assert.equal(leadRows(runtime.leads)[0][2], 'Lesley Naidoo');
});

test('15. website enquiries do not depend on onFormSubmit', () => {
  assert.equal(/\bfunction\s+onFormSubmit\b/.test(source), false);
  assert.equal(/\bonFormSubmit\s*\(/.test(source), false);
  const runtime = load();
  const result = parseJson(runtime.sandbox.doPost(jsonPost(validEnquiry)));
  assert.equal(result.ok, true);
  assert.equal(typeof runtime.sandbox.onFormSubmit, 'undefined');
});

test('html iframe response postMessages a public payload and allows framing', () => {
  const runtime = load();
  const output = runtime.sandbox.doPost(formPost(validEnquiry));
  assert.equal(output.xframe, 'ALLOWALL');
  const html = output.getContent();
  assert.match(html, /postMessage\(payload,"\*"\)/);
  assert.match(html, /win\.parent/);
  assert.equal(html.includes('document.referrer'), false);
  assert.equal(html.includes('owner@example.co.za'), false);
  assert.equal(html.includes(SPREADSHEET_ID), false);
  assert.match(html, /"ok":true/);
  assert.match(html, /"status":"RECEIVED"/);
});

test('formula and email-header injection are neutralised', () => {
  const runtime = load();
  const result = runtime.sandbox.processEnquiry({
    ...validEnquiry,
    name: '=HYPERLINK("http://evil.example")',
    email: 'customer@example.co.za\nBcc: attacker@example.com',
    message: '=CMD()'
  });
  assert.equal(result.ok, false);
  const saved = runtime.sandbox.processEnquiry({
    ...validEnquiry,
    name: '=HYPERLINK("http://evil.example")',
    message: '=CMD()'
  });
  assert.equal(saved.ok, true);
  assert.equal(String(runtime.leads.rows[1][2]).startsWith("'="), true);
  assert.equal(String(runtime.leads.rows[1][7]).startsWith("'="), true);
  assert.equal(runtime.mail.sent[0].to.includes('\n'), false);
  assert.equal(runtime.mail.sent[0].subject.includes('\n'), false);
});

test('test mode does not send MailApp messages', () => {
  const runtime = load({ environment: 'test' });
  const result = runtime.sandbox.processEnquiry(validEnquiry);
  assert.equal(result.ok, true);
  assert.equal(runtime.mail.sent.length, 0);
  assert.equal(result.notifications.customer.status, 'skipped:test-mode');
  assert.equal(leadRows(runtime.leads).length, 1);
});

test('WhatsApp remains disabled and is not required to save', () => {
  const runtime = load();
  const result = runtime.sandbox.processEnquiry(validEnquiry);
  assert.equal(result.notifications.whatsapp.status, 'disabled');
  assert.equal(result.notifications.whatsapp.skipped, true);
  assert.equal(leadRows(runtime.leads).length, 1);
});

test('authorised confirmEnquiry can set CONFIRMED/WON; doPost cannot', () => {
  const runtime = load();
  const created = runtime.sandbox.processEnquiry(validEnquiry);
  const confirmed = runtime.sandbox.confirmEnquiry(created.reference);
  assert.equal(confirmed.ok, true);
  assert.equal(confirmed.status, 'CONFIRMED');
  assert.equal(runtime.leads.rows[1][11], 'WON');
  const viaWeb = parseJson(runtime.sandbox.doPost(jsonPost({
    ...validEnquiry,
    submissionKey: KEY_TWO,
    status: 'CONFIRMED'
  })));
  assert.equal(viaWeb.status, 'RECEIVED');
  assert.equal(runtime.leads.rows[2][11], 'NEW');
});

test('honeypot submissions are discarded', () => {
  const runtime = load();
  const result = parseJson(runtime.sandbox.doPost(jsonPost({ ...validEnquiry, fax_number: '1' })));
  assert.equal(result.ok, false);
  assert.equal(leadRows(runtime.leads).length, 0);
  assert.equal(runtime.mail.sent.length, 0);
});

test('public JSON does not expose owner email or spreadsheet id', () => {
  const runtime = load();
  const result = parseJson(runtime.sandbox.doPost(jsonPost(validEnquiry)));
  const raw = JSON.stringify(result);
  assert.equal(raw.includes('owner@example.co.za'), false);
  assert.equal(raw.includes(SPREADSHEET_ID), false);
  assert.equal(result.ok, true);
});

test('getConfiguration reads script properties', () => {
  const runtime = load({
    properties: {
      SPREADSHEET_ID,
      OWNER_EMAIL: 'owner@example.co.za',
      ENVIRONMENT: 'production',
      WHATSAPP_ENABLED: 'false'
    }
  });
  const config = runtime.sandbox.getConfiguration();
  assert.equal(config.spreadsheetId, SPREADSHEET_ID);
  assert.equal(config.sheetName, 'Leads');
  assert.equal(config.ownerEmail, 'owner@example.co.za');
  assert.equal(config.whatsappEnabled, false);
});
