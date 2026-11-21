/**
 * In-memory Google services for the Release 1 security tests.
 *
 * SpreadsheetApp, MailApp, CacheService, LockService, PropertiesService and
 * Utilities are fakes. Nothing here calls Google, opens the production
 * spreadsheet, or sends email. A passing test is not evidence that the live
 * Apps Script deployment works.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

export const source = readFileSync(fileURLToPath(new URL('../../../apps-script/EnquiryWebApp.gs', import.meta.url)), 'utf8');
export const SPREADSHEET_ID = '1N2xHXT2t28CdSBkZFihbOxgk9H3kK2-8n0QK2kXrW4M';

export const LEAD_HEADERS = [
  'Lead ID', 'Date received', 'Full name', 'Email address', 'Phone number', 'Company name',
  'Service requested', 'Message / project description', 'Lead source', 'Website page',
  'Consent to contact', 'Lead status', 'Priority', 'Assigned person', 'Last contacted',
  'Follow-up date', 'Internal notes', 'Submission key', 'Duplicate of', 'Phone (normalised)', 'Counted'
];
export const ERROR_HEADERS = ['Timestamp', 'Code', 'Stage', 'Lead ID', 'Detail (no personal data)'];

let keyCounter = 0;
export function uniqueKey() {
  keyCounter += 1;
  return `44444444-4444-4444-8444-${String(keyCounter).padStart(12, '0')}`;
}

export function enquiry(overrides = {}) {
  return {
    name: 'Thandi Mokoena',
    email: 'thandi@example.co.za',
    business: 'Mokoena Interiors',
    phone: '082 555 0101',
    service: 'Web Solutions',
    message: 'Please quote a five-page website for an interior design studio.',
    page: '/contact.html',
    formElapsedMs: '42000',
    privacyNotice: '2026-11-21',
    submissionKey: uniqueKey(),
    ...overrides
  };
}

function createSheet(headers, maxRows = 40) {
  const blank = () => Array.from({ length: headers.length }, () => '');
  const rows = [headers.slice()];
  while (rows.length < maxRows) rows.push(blank());
  const sheet = {
    rows,
    getMaxRows() { return rows.length; },
    getRange(row, column, numRows = 1, numColumns = 1) {
      return {
        getValues() {
          const values = [];
          for (let i = 0; i < numRows; i += 1) {
            const sourceRow = rows[row - 1 + i] || blank();
            values.push(sourceRow.slice(column - 1, column - 1 + numColumns).map((value) => (value === undefined ? '' : value)));
          }
          return values;
        },
        setValues(input) {
          for (let i = 0; i < numRows; i += 1) {
            for (let j = 0; j < numColumns; j += 1) rows[row - 1 + i][column - 1 + j] = input[i][j];
          }
        },
        setNumberFormat() {},
        setFormula(formula) {
          const match = /^="([\s\S]*)"$/.exec(formula);
          rows[row - 1][column - 1] = match ? match[1].replace(/""/g, '"') : formula;
        },
        setValue(value) { rows[row - 1][column - 1] = value; }
      };
    }
  };
  return sheet;
}

function createLock() {
  return {
    held: false,
    tryLock() { if (this.held) return false; this.held = true; return true; },
    releaseLock() { this.held = false; }
  };
}

export function load(options = {}) {
  const leads = createSheet(LEAD_HEADERS);
  leads.rows[1][20] = '=ARRAYFORMULA(IF(A2:A="","",1))';
  const errorLog = createSheet(ERROR_HEADERS);
  const sheets = { Leads: leads, 'Error Log': errorLog };
  const cacheStore = options.cacheStore || new Map();
  const logs = [];
  const mail = { sent: [], failTimes: options.mailFailTimes || 0, quota: options.quota === undefined ? 100 : options.quota };
  const properties = {
    SPREADSHEET_ID,
    SHEET_NAME: 'Leads',
    OWNER_EMAIL: 'owner@example.co.za',
    ENVIRONMENT: 'production',
    WHATSAPP_ENABLED: 'false',
    ...options.properties
  };
  const scriptLock = createLock();
  const sandbox = {
    Date, JSON, Object, String, Number, Array, Math, RegExp, parseInt, isNaN,
    console: { log(message) { logs.push(String(message)); } },
    SpreadsheetApp: {
      openById(id) {
        if (id !== SPREADSHEET_ID) throw new Error(`Exception: Document ${id} is missing (internal detail)`);
        return { getSheetByName(name) { return sheets[name] || null; } };
      }
    },
    LockService: { getScriptLock() { return scriptLock; }, getUserLock() { return createLock(); } },
    PropertiesService: {
      getScriptProperties() {
        return { getProperty(name) { return Object.prototype.hasOwnProperty.call(properties, name) ? properties[name] : null; } };
      }
    },
    CacheService: {
      getScriptCache() {
        return {
          get(key) { return cacheStore.has(key) ? cacheStore.get(key) : null; },
          put(key, value) { cacheStore.set(key, value); }
        };
      }
    },
    MailApp: {
      getRemainingDailyQuota() { return mail.quota; },
      sendEmail(opts) {
        if (mail.failTimes > 0) {
          mail.failTimes -= 1;
          throw new Error('Service invoked too many times for one day: email. (internal detail)');
        }
        mail.quota -= 1;
        mail.sent.push(opts);
      }
    },
    ContentService: {
      MimeType: { JSON: 'JSON' },
      createTextOutput(text) { return { text, setMimeType() { return this; }, getContent() { return this.text; } }; }
    },
    HtmlService: {
      XFrameOptionsMode: { ALLOWALL: 'ALLOWALL' },
      createHtmlOutput(html) { return { html, setXFrameOptionsMode() { return this; }, getContent() { return this.html; } }; }
    },
    Utilities: {
      getUuid() { return uniqueKey(); },
      formatDate(date, timeZone, pattern) {
        const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
          timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
        }).formatToParts(date).map((part) => [part.type, part.value]));
        if (pattern === 'yyyyMMdd') return `${parts.year}${parts.month}${parts.day}`;
        return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}+02:00`;
      }
    }
  };
  runInNewContext(source, sandbox, { filename: 'EnquiryWebApp.gs' });
  return { sandbox, leads, errorLog, mail, logs, cacheStore, properties };
}

export function post(runtime, payload) {
  const output = runtime.sandbox.doPost({ postData: { type: 'text/plain', contents: JSON.stringify(payload) } });
  return JSON.parse(output.getContent());
}

export function formPost(runtime, parameter) {
  return runtime.sandbox.doPost({ parameter: { ...parameter, responseFormat: 'json' } });
}

export function savedRows(leads) {
  return leads.rows.filter((row, index) => index > 0 && String(row[0] || '').trim());
}
