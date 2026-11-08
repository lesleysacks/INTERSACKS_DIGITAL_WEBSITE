/**
 * Standalone Apps Script web app for InterSacks Digital website enquiries.
 *
 * Create this as a NEW standalone project. Do not paste it into, or replace,
 * any existing Client Operations project.
 *
 * The script opens the lead spreadsheet by ID. It does not use
 * getActiveSpreadsheet(), and it does not read or write the Dashboard or
 * Lists tabs.
 *
 * Counted (column U) is an ARRAYFORMULA owned by the sheet:
 *   =ARRAYFORMULA(IF(A2:A="","",IF((L2:L="SPAM")+(S2:S<>"")>0,0,1)))
 * A new unique lead is counted because its status is not SPAM and
 * "Duplicate of" is blank. This script never writes column U. Writing TRUE
 * into that column would block the formula and break the dashboard.
 *
 * Lead status, priority and source use the Lists tab values the dashboard
 * already counts. "NEW" matches COUNTIFS on Leads!L. Priority "Medium" is
 * the middle Lists value (Low, Medium, High). Lead source is Lists!D2.
 *
 * Duplicate protection is the submission key only. A repeated key returns
 * the original lead and does not add a row. A second enquiry from the same
 * email address or phone number is a new lead.
 *
 * The proxy signs each request with HMAC-SHA256. The signed string is
 * enquiry.v1, the unix timestamp, the nonce, and the enquiry JSON. It must
 * match canonicalMessage in server/enquiry-handler.mjs. The raw secret is
 * not sent. A nonce can be used once inside the acceptance window.
 *
 * Requests that have not passed HMAC verification never open the
 * spreadsheet. Their failures are written to the execution log, at most
 * once a minute per reason when the script cache is available.
 *
 * ENQUIRY_PROXY_TOKEN must be at least 32 bytes, stored as 64 hex
 * characters from `openssl rand -hex 32`. Do not commit or print that value.
 */
var SPREADSHEET_ID = '1N2xHXT2t28CdSBkZFihbOxgk9H3kK2-8n0QK2kXrW4M';
var LEADS_SHEET = 'Leads';
var ERROR_LOG_SHEET = 'Error Log';
var TOKEN_PROPERTY = 'ENQUIRY_PROXY_TOKEN';
var LEAD_SOURCE = 'Website \u2013 Contact form';
var LEAD_STATUS = 'NEW';
var LEAD_PRIORITY = 'Medium';
var RATE_LIMIT_PER_HOUR = 20;
var LOCK_WAIT_MS = 15000;
var AUTH_SKEW_SECONDS = 300;
var NONCE_TTL_SECONDS = 600;
var MIN_SECRET_LENGTH = 64;
var UNAUTH_LOG_TTL_SECONDS = 60;
var SIGNED_FIELDS = [
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

var LEAD_HEADERS = [
  'Lead ID',
  'Date received',
  'Full name',
  'Email address',
  'Phone number',
  'Company name',
  'Service requested',
  'Message / project description',
  'Lead source',
  'Website page',
  'Consent to contact',
  'Lead status',
  'Priority',
  'Assigned person',
  'Last contacted',
  'Follow-up date',
  'Internal notes',
  'Submission key',
  'Duplicate of',
  'Phone (normalised)',
  'Counted'
];

var ERROR_LOG_HEADERS = [
  'Timestamp',
  'Code',
  'Stage',
  'Lead ID',
  'Detail (no personal data)'
];

var SERVICE_VALUES = {
  'Web Solutions': true,
  'Branding': true,
  'Business Automation': true,
  'AI & Software': true
};

function doGet() {
  return json_({
    ok: false,
    code: 'METHOD_NOT_ALLOWED',
    message: 'Send the enquiry with POST.'
  });
}

function doPost(e) {
  var parsed = readPayload_(e);
  if (parsed.error) {
    noteUnauthenticated_('INVALID_JSON');
    return json_({ ok: false, code: 'VALIDATION', message: 'Check the enquiry and try again.' });
  }

  var payload = parsed.payload;
  var authState = signatureState_(payload);
  if (authState === 'missing-config') {
    noteUnauthenticated_('CONFIG');
    return json_({
      ok: false,
      code: 'CONFIG',
      message: 'We could not save your enquiry. Please try again.'
    });
  }
  if (authState === 'expired') {
    noteUnauthenticated_('EXPIRED');
    return json_({
      ok: false,
      code: 'EXPIRED',
      message: 'We could not save your enquiry. Please try again.'
    });
  }
  if (authState !== 'ok') {
    noteUnauthenticated_('UNAUTHORISED');
    return json_({
      ok: false,
      code: 'UNAUTHORISED',
      message: 'We could not save your enquiry. Please try again.'
    });
  }

  var validated = validateEnquiry_(payload);
  if (!validated.ok) {
    logError_('VALIDATION', 'validate', '', validated.logDetail);
    return json_({ ok: false, code: 'VALIDATION', message: validated.message });
  }

  var lock = LockService.getScriptLock();
  var locked = false;
  try {
    locked = lock.tryLock(LOCK_WAIT_MS);
    if (!locked) {
      logError_('LOCKED', 'lock', '', 'Could not acquire the script lock.');
      return json_({
        ok: false,
        code: 'LOCKED',
        message: 'Please try again in a moment.'
      });
    }

    // The script lock is held here, so the nonce read and insert cannot race.
    var nonceState = consumeNonce_(String(payload.nonce));
    if (nonceState === 'replay') {
      logError_('REPLAY', 'auth', '', 'Rejected a replayed nonce.');
      return json_({
        ok: false,
        code: 'REPLAY',
        message: 'We could not save your enquiry. Please try again.'
      });
    }
    if (nonceState !== 'ok') {
      logError_('AUTH_UNAVAILABLE', 'auth', '', 'Nonce replay protection was unavailable.');
      return json_({
        ok: false,
        code: 'AUTH_UNAVAILABLE',
        message: 'We could not save your enquiry. Please try again.'
      });
    }

    var spreadsheet;
    try {
      spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
    } catch (openError) {
      logError_('SPREADSHEET_UNAVAILABLE', 'spreadsheet', '', 'The spreadsheet could not be opened.');
      return json_({
        ok: false,
        code: 'SPREADSHEET_UNAVAILABLE',
        message: 'We could not save your enquiry. Please try again.'
      });
    }

    var leads = spreadsheet.getSheetByName(LEADS_SHEET);
    if (!leads) {
      logError_('SHEET_MISSING', 'leads', '', 'The Leads sheet is missing.', spreadsheet);
      return json_({
        ok: false,
        code: 'SHEET_MISSING',
        message: 'We could not save your enquiry. Please try again.'
      });
    }

    var headerCheck = headersMatch_(leads, LEAD_HEADERS);
    if (!headerCheck.ok) {
      logError_('HEADER_MISMATCH', 'headers', '', 'The Leads header row does not match the expected schema.', spreadsheet);
      return json_({
        ok: false,
        code: 'HEADER_MISMATCH',
        message: 'We could not save your enquiry. Please try again.'
      });
    }

    var width = LEAD_HEADERS.length - 1;
    var rows = leads.getRange(1, 1, leads.getMaxRows(), width).getValues();
    var existing = findSubmission_(rows, validated.submissionKey);
    if (existing) {
      return json_({ ok: true, leadId: existing.leadId, duplicate: true });
    }

    if (!withinRateLimit_(validated.email)) {
      logError_('RATE_LIMIT', 'rate', '', 'The hourly enquiry limit was reached.', spreadsheet);
      return json_({
        ok: false,
        code: 'RATE_LIMIT',
        message: 'Please wait a few minutes and try again.'
      });
    }

    var leadId = nextLeadId_(rows, new Date());
    var nextRow = nextDataRow_(rows);
    if (nextRow > leads.getMaxRows()) {
      logError_('SHEET_FULL', 'write', leadId, 'The Leads sheet has no empty row.', spreadsheet);
      return json_({
        ok: false,
        code: 'SHEET_FULL',
        message: 'We could not save your enquiry. Please try again.'
      });
    }

    // Columns A-T only. Column U (Counted) stays under the ARRAYFORMULA.
    // Text format stops values such as "+27..." and "=..." being stored as formulas.
    textColumns_(leads, nextRow);
    leads.getRange(nextRow, 1, 1, width).setValues([[
      leadId,
      new Date(),
      asText_(validated.name),
      asText_(validated.email),
      validated.phone,
      asText_(validated.company),
      validated.service,
      asText_(validated.message),
      LEAD_SOURCE,
      validated.page,
      'Yes',
      LEAD_STATUS,
      LEAD_PRIORITY,
      '',
      '',
      '',
      '',
      validated.submissionKey,
      '',
      asText_(validated.phoneNormalised)
    ]]);
    // A typed number that starts with + must stay exactly as entered. A text
    // formula displays that string; the normalised column keeps its own copy.
    if (/^[=+\-@]/.test(validated.phone)) {
      leads.getRange(nextRow, 5).setFormula('="' + validated.phone.replace(/"/g, '""') + '"');
    }

    return json_({ ok: true, leadId: leadId, duplicate: false });
  } catch (unexpected) {
    logError_('INTERNAL', 'runtime', '', 'Unexpected failure while saving an enquiry.');
    return json_({
      ok: false,
      code: 'INTERNAL',
      message: 'We could not save your enquiry. Please try again.'
    });
  } finally {
    if (locked) lock.releaseLock();
  }
}

function readPayload_(e) {
  if (!e || !e.postData || typeof e.postData.contents !== 'string') {
    return { error: true };
  }
  if (e.postData.contents.length > 20000) return { error: true };
  try {
    var payload = JSON.parse(e.postData.contents);
    if (!payload || typeof payload !== 'object' || Object.prototype.toString.call(payload) === '[object Array]') {
      return { error: true };
    }
    return { payload: payload };
  } catch (parseError) {
    return { error: true };
  }
}

function signatureState_(payload) {
  var secret = '';
  try {
    secret = PropertiesService.getScriptProperties().getProperty(TOKEN_PROPERTY) || '';
  } catch (propertyError) {
    return 'missing-config';
  }
  if (!secret || secret.length < MIN_SECRET_LENGTH) return 'missing-config';
  var timestamp = Number(payload.timestamp);
  var nonce = String(payload.nonce || '');
  var signature = String(payload.signature || '').toLowerCase();
  if (!isFinite(timestamp) || Math.floor(timestamp) !== timestamp) return 'rejected';
  if (!/^[A-Za-z0-9-]{16,80}$/.test(nonce)) return 'rejected';
  if (!/^[0-9a-f]{64}$/.test(signature)) return 'rejected';
  var nowSeconds = Math.floor(new Date().getTime() / 1000);
  if (Math.abs(nowSeconds - timestamp) > AUTH_SKEW_SECONDS) return 'expired';
  var expected = hmacHex_(secret, canonicalMessage_(payload, timestamp, nonce));
  if (expected.length !== signature.length) return 'rejected';
  var mismatch = 0;
  for (var i = 0; i < expected.length; i++) mismatch |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return mismatch === 0 ? 'ok' : 'rejected';
}

function canonicalMessage_(payload, timestamp, nonce) {
  var fields = {};
  for (var i = 0; i < SIGNED_FIELDS.length; i++) {
    var key = SIGNED_FIELDS[i];
    if (Object.prototype.hasOwnProperty.call(payload, key)) fields[key] = payload[key];
  }
  return 'enquiry.v1\n' + timestamp + '\n' + nonce + '\n' + JSON.stringify(fields);
}

function hmacHex_(secret, message) {
  var bytes = Utilities.computeHmacSha256Signature(message, secret);
  var hex = '';
  for (var i = 0; i < bytes.length; i++) {
    var value = bytes[i];
    if (value < 0) value += 256;
    var pair = value.toString(16);
    hex += pair.length === 1 ? '0' + pair : pair;
  }
  return hex;
}

// Call only while the script lock is held. CacheService is not durable
// storage: an entry can be evicted before NONCE_TTL_SECONDS, the longest
// TTL Google accepts is six hours, and a forgotten nonce can be accepted
// again until the signed timestamp itself expires. A thrown cache call, or
// a put that does not read back, fails closed and the lead is not written.
function consumeNonce_(nonce) {
  try {
    var cache = CacheService.getScriptCache();
    var key = 'enquiry-nonce:' + nonce;
    if (cache.get(key)) return 'replay';
    cache.put(key, '1', NONCE_TTL_SECONDS);
    if (cache.get(key) !== '1') return 'unavailable';
    return 'ok';
  } catch (cacheError) {
    return 'unavailable';
  }
}

// Unauthenticated failures must not open the spreadsheet. When the script
// cache is available, one execution-log line is emitted per code per minute.
// If that cache is down, each execution still logs one fixed line and still
// does not write a row.
function noteUnauthenticated_(code) {
  var label = String(code || 'UNAUTHORISED');
  try {
    var cache = CacheService.getScriptCache();
    var key = 'unauth-note:' + label;
    if (cache.get(key)) return;
    cache.put(key, '1', UNAUTH_LOG_TTL_SECONDS);
  } catch (ignore) {
    // Continue to the execution log. Do not open the spreadsheet.
  }
  try {
    console.log('Unauthenticated enquiry rejected: ' + label);
  } catch (ignoreLog) {
    // The visitor response is already decided.
  }
}

function validateEnquiry_(payload) {
  if (String(payload.fax_number || '').trim()) {
    return { ok: false, message: 'Check the enquiry and try again.', logDetail: 'A honeypot field was completed.' };
  }

  var name = cleanText_(payload.name, 120);
  if (!name) return { ok: false, message: 'Enter your full name.', logDetail: 'Name was missing.' };

  var email = cleanText_(payload.email, 254);
  if (!isEmail_(email)) return { ok: false, message: 'Enter a valid email address.', logDetail: 'Email was missing or invalid.' };

  var company = cleanText_(payload.business || payload.company || '', 160);
  var phoneResult = normalisePhone_(payload.phone);
  if (!phoneResult.ok) {
    return {
      ok: false,
      message: 'Enter a valid South African phone number, or leave the phone field blank.',
      logDetail: 'Phone number was invalid.'
    };
  }

  var service = cleanText_(payload.service, 80);
  if (!SERVICE_VALUES[service]) {
    return { ok: false, message: 'Choose the service you need.', logDetail: 'Service was missing or unknown.' };
  }

  var message = cleanText_(payload.message, 4000);
  if (!message) return { ok: false, message: 'Describe your project.', logDetail: 'Project description was missing.' };

  if (!consentGiven_(payload.consent)) {
    return { ok: false, message: 'Agree to be contacted about this enquiry before sending it.', logDetail: 'Consent was missing.' };
  }

  var page = cleanPage_(payload.page);
  if (!page) return { ok: false, message: 'Check the enquiry and try again.', logDetail: 'Website page was invalid.' };

  var submissionKey = cleanText_(payload.submissionKey, 80);
  if (!submissionKey) {
    try {
      submissionKey = Utilities.getUuid();
    } catch (uuidError) {
      return { ok: false, message: 'Check the enquiry and try again.', logDetail: 'Submission key could not be generated.' };
    }
  }
  if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(submissionKey)) {
    return { ok: false, message: 'Check the enquiry and try again.', logDetail: 'Submission key was invalid.' };
  }

  return {
    ok: true,
    name: name,
    email: email,
    company: company,
    phone: phoneResult.original,
    phoneNormalised: phoneResult.normalised,
    service: service,
    message: message,
    page: page,
    submissionKey: submissionKey
  };
}

function consentGiven_(value) {
  if (value === true) return true;
  var text = String(value == null ? '' : value).trim().toLowerCase();
  return text === 'yes' || text === 'true' || text === 'on';
}

function cleanText_(value, maxLength) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function cleanPage_(value) {
  var page = String(value == null ? '' : value).trim();
  if (!page) return '/contact.html';
  page = page.split('#')[0].split('?')[0];
  if (/^https?:\/\//i.test(page)) return '';
  if (page.charAt(0) !== '/') page = '/' + page;
  if (page.length > 200 || page.indexOf('//') !== -1) return '';
  if (!/^\/[A-Za-z0-9._~/-]*$/.test(page)) return '';
  return page;
}

function isEmail_(value) {
  if (!value || value.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}

/**
 * South African numbers become +27 and nine national digits.
 * The original typed value is preserved separately.
 * Empty is allowed. Other countries are rejected.
 */
function normalisePhone_(raw) {
  var original = String(raw == null ? '' : raw).trim();
  if (!original) return { ok: true, original: '', normalised: '' };
  if (original.length > 40) return { ok: false };
  var compact = original.replace(/[\s()./-]/g, '');
  if (!/^\+?\d+$/.test(compact)) return { ok: false };
  var digits = compact.charAt(0) === '+' ? compact.slice(1) : compact;
  var national = '';
  if (digits.length === 11 && digits.slice(0, 2) === '27') national = digits.slice(2);
  else if (digits.length === 10 && digits.charAt(0) === '0') national = digits.slice(1);
  else return { ok: false };
  if (!/^[1-9][0-9]{8}$/.test(national)) return { ok: false };
  return { ok: true, original: original, normalised: '+27' + national };
}

function asText_(value) {
  var text = String(value == null ? '' : value);
  if (/^[=+\-@]/.test(text)) return "'" + text;
  return text;
}

function textColumns_(sheet, row) {
  var columns = [3, 4, 5, 6, 8, 20];
  for (var i = 0; i < columns.length; i++) {
    sheet.getRange(row, columns[i]).setNumberFormat('@');
  }
}

function headersMatch_(sheet, expected) {
  var actual = sheet.getRange(1, 1, 1, expected.length).getValues()[0];
  for (var i = 0; i < expected.length; i++) {
    if (String(actual[i] || '').trim() !== expected[i]) return { ok: false };
  }
  return { ok: true };
}

function findSubmission_(rows, key) {
  for (var i = 1; i < rows.length; i++) {
    var leadId = String(rows[i][0] || '').trim();
    var existingKey = String(rows[i][17] || '').trim();
    if (leadId && existingKey === key) return { rowNumber: i + 1, leadId: leadId };
  }
  return null;
}

function nextDataRow_(rows) {
  var lastDataIndex = 0;
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0] || '').trim()) lastDataIndex = i;
  }
  return lastDataIndex + 2;
}

function nextLeadId_(rows, now) {
  var stamp = Utilities.formatDate(now, 'Africa/Johannesburg', 'yyyyMMdd');
  var max = 0;
  for (var i = 1; i < rows.length; i++) {
    var match = /^ISD-\d{8}-(\d+)$/.exec(String(rows[i][0] || '').trim());
    if (!match) continue;
    var sequence = Number(match[1]);
    if (sequence > max) max = sequence;
  }
  var next = String(max + 1);
  while (next.length < 4) next = '0' + next;
  return 'ISD-' + stamp + '-' + next;
}

// Best-effort courtesy limit, kept fail-open on purpose. A cache error here
// still allows the lead so a cache blip does not discard a real enquiry that
// has already passed HMAC and nonce checks. The counter can also be evicted
// before the hour ends. This is not a guaranteed cap. If the whole script
// cache is down, consumeNonce_ fails closed first and this function is not
// reached.
function withinRateLimit_(email) {
  try {
    var cache = CacheService.getScriptCache();
    var key = 'lead-rate:' + rateHash_(email.toLowerCase());
    var count = Number(cache.get(key) || '0');
    if (count >= RATE_LIMIT_PER_HOUR) return false;
    cache.put(key, String(count + 1), 3600);
    return true;
  } catch (cacheError) {
    return true;
  }
}

function rateHash_(text) {
  var hash = 0;
  for (var i = 0; i < text.length; i++) hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  return String(hash);
}

function logError_(code, stage, leadId, detail, spreadsheet) {
  try {
    var book = spreadsheet;
    if (!book) book = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = book.getSheetByName(ERROR_LOG_SHEET);
    if (!sheet) return;
    if (!headersMatch_(sheet, ERROR_LOG_HEADERS).ok) return;
    var column = sheet.getRange(1, 1, sheet.getMaxRows(), 1).getValues();
    var last = 0;
    for (var i = 1; i < column.length; i++) {
      if (String(column[i][0] || '').trim()) last = i;
    }
    var row = last + 2;
    if (row > sheet.getMaxRows()) return;
    sheet.getRange(row, 1, 1, ERROR_LOG_HEADERS.length).setValues([[
      new Date(),
      code,
      stage,
      leadId || '',
      safeDetail_(detail)
    ]]);
  } catch (logError) {
    // The exception text can contain the spreadsheet id. Keep the line fixed.
    try {
      console.log('Enquiry error log was not written.');
    } catch (ignoreLog) {
      // The visitor response is already decided.
    }
  }
}

function safeDetail_(text) {
  var detail = String(text || '').replace(/\s+/g, ' ').trim();
  detail = detail.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted]');
  detail = detail.replace(/\+?\d[\d\s().-]{6,}\d/g, '[redacted]');
  if (detail.indexOf(SPREADSHEET_ID) !== -1) detail = detail.split(SPREADSHEET_ID).join('[redacted]');
  if (detail.length > 180) detail = detail.slice(0, 180);
  return detail;
}

function json_(body) {
  var safe;
  if (body.ok === true) {
    safe = { ok: true, leadId: String(body.leadId || ''), duplicate: body.duplicate === true };
  } else {
    safe = {
      ok: false,
      code: String(body.code || 'INTERNAL'),
      message: String(body.message || 'We could not save your enquiry. Please try again.')
    };
  }
  return ContentService.createTextOutput(JSON.stringify(safe)).setMimeType(ContentService.MimeType.JSON);
}
