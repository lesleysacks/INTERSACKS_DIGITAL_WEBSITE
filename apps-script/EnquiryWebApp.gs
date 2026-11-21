/**
 * InterSacks Digital enquiry web app.
 *
 * This is the only enquiry backend. Website POST requests are handled by
 * doPost(e). There is no onFormSubmit trigger, no Node proxy, and no other
 * database.
 *
 * The production spreadsheet is "InterSacks – Enquiries". This script opens
 * it by ID and writes the existing Leads columns A–T only. Column U stays
 * under the sheet's ARRAYFORMULA. Dashboard and Lists are not rewritten.
 *
 * Enquiry lifecycle versus the existing Lists / Dashboard values:
 *
 *   RECEIVED              -> Lead status NEW
 *   PENDING_CONFIRMATION  -> Lead status CONTACTED
 *   CONFIRMED             -> Lead status WON
 *   CANCELLED             -> Lead status LOST
 *
 * doPost always stores RECEIVED/NEW. CONFIRMED is only set by an authorised
 * function run from the Apps Script editor, or by an owner changing the
 * sheet by hand. A website acknowledgement is not a confirmed booking.
 *
 * Website submissions use a hidden iframe POST. doPost returns an HtmlService
 * page that postMessages the result to the parent origin. fetch/no-cors is
 * not used. JSON responses remain available for tests and for text/plain
 * POST bodies.
 *
 * External submissions are accepted only when ENVIRONMENT is exactly
 * "production" and the spreadsheet id and owner email are set. A missing
 * environment, "test", or "development" returns TEST_MODE and does not
 * open the spreadsheet or send mail. runSafeSelfTest() does not save a lead.
 *
 * Release 1 hardening (see docs/releases/RELEASE_1_ENQUIRY_HARDENING.md):
 *
 *   - Only the known website fields are read. Anything else is ignored.
 *   - Text is normalised and stripped of control, bidi and zero-width
 *     characters before it is validated, stored or emailed.
 *   - Email addresses must match a strict single-address pattern, so a
 *     comma, semicolon, quote, angle bracket or line break can never add a
 *     second recipient.
 *   - Hourly limits apply per email address, per phone number and to the
 *     whole web app. Apps Script does not expose the visitor IP address, so
 *     an IP-based limit is not possible here.
 *   - An identical enquiry (same email, service and message) within 24 hours
 *     returns the original reference instead of a new row and new emails.
 *   - The owner is notified first. The customer acknowledgement has a fixed
 *     template, is only sent to the address on a valid enquiry, and is
 *     skipped when the hourly customer-email cap or the daily MailApp
 *     reserve for owner notifications would be exceeded.
 *   - "Consent to contact" is no longer written as an automatic "Yes". The
 *     column records that the reply is at the visitor's request, plus the
 *     visitor's own optional marketing choice. Evidence (privacy notice
 *     version, timestamp, choice) is written to Internal notes.
 *   - The form sends how long it was open (formElapsedMs). Very fast or
 *     malformed values are rejected. This is a bot deterrent only: a
 *     scripted client can send any value. Set REQUIRE_FORM_TIMING=true once
 *     the Release 1 website is live to reject requests without the field.
 */

var KNOWN_SPREADSHEET_ID = '1N2xHXT2t28CdSBkZFihbOxgk9H3kK2-8n0QK2kXrW4M';
var DEFAULT_SHEET_NAME = 'Leads';
var DEFAULT_ERROR_SHEET = 'Error Log';
var LEAD_SOURCE = 'Website \u2013 Contact form';
var LOCK_WAIT_MS = 15000;
var ERROR_LOG_LOCK_WAIT_MS = 5000;
var RATE_LIMIT_PER_HOUR = 5;
var PHONE_RATE_LIMIT_PER_HOUR = 5;
var DEFAULT_GLOBAL_HOURLY_LIMIT = 30;
var DEFAULT_CUSTOMER_EMAIL_HOURLY_LIMIT = 15;
var DEFAULT_OWNER_MAIL_RESERVE = 20;
var MAX_NOTIFICATION_RETRIES = 2;
var DUPLICATE_WINDOW_MS = 24 * 60 * 60 * 1000;
var MIN_FORM_ELAPSED_MS = 3000;
var MAX_FORM_ELAPSED_MS = 24 * 60 * 60 * 1000;
var MAX_REQUEST_CHARS = 20000;
var CHANNEL = 'intersacks-enquiry';

var CONSENT_REPLY_ONLY = 'Reply to enquiry only (visitor request)';
var CONSENT_REPLY_AND_MARKETING = 'Reply to enquiry + marketing opt-in';

var STATUS = {
  RECEIVED: 'RECEIVED',
  PENDING_CONFIRMATION: 'PENDING_CONFIRMATION',
  CONFIRMED: 'CONFIRMED',
  CANCELLED: 'CANCELLED'
};

var SHEET_STATUS = {
  RECEIVED: 'NEW',
  PENDING_CONFIRMATION: 'CONTACTED',
  CONFIRMED: 'WON',
  CANCELLED: 'LOST'
};

var LEAD_PRIORITY = 'Medium';

var SERVICE_VALUES = {
  'Web Solutions': true,
  'Branding': true,
  'Business Automation': true,
  'AI & Software': true
};

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

function doGet() {
  return createJsonResponse({
    ok: false,
    code: 'METHOD_NOT_ALLOWED',
    message: 'Send the enquiry with POST.'
  });
}

function doPost(e) {
  var parsed = parseRequest(e);
  if (parsed.error) {
    noteOperational_(parsed.reason === 'no-event' ? 'INVALID_JSON_NO_EVENT' : 'INVALID_JSON');
    return respond_({
      ok: false,
      code: 'VALIDATION',
      message: 'Check the enquiry and try again.'
    }, parsed.format || 'json');
  }

  var result = processEnquiry(parsed.payload);
  return respond_(result, parsed.format);
}

function processEnquiry(data) {
  var validated = validateEnquiry(data);
  if (!validated.ok) {
    noteOperational_('VALIDATION');
    return {
      ok: false,
      code: 'VALIDATION',
      message: validated.message,
      submissionKey: validated.submissionKey || ''
    };
  }

  var gate = submissionGate_();
  if (!gate.ok) {
    noteOperational_(gate.code);
    return {
      ok: false,
      code: gate.code,
      message: gate.message,
      submissionKey: validated.submissionKey
    };
  }

  var saved;
  var lock = LockService.getScriptLock();
  var locked = false;
  try {
    locked = lock.tryLock(LOCK_WAIT_MS);
    if (!locked) {
      logError('LOCKED', 'lock', '', 'Could not acquire the script lock.');
      return {
        ok: false,
        code: 'LOCKED',
        message: 'Please try again in a moment.',
        submissionKey: validated.submissionKey
      };
    }
    saved = saveEnquiry(validated);
  } catch (unexpected) {
    logError('INTERNAL', 'runtime', '', 'Unexpected failure while saving an enquiry.');
    return {
      ok: false,
      code: 'INTERNAL',
      message: 'We could not save your enquiry. Please try again.',
      submissionKey: validated.submissionKey
    };
  } finally {
    if (locked) {
      try { lock.releaseLock(); } catch (ignoreRelease) {}
    }
  }

  if (!saved || !saved.ok) {
    return saved || {
      ok: false,
      code: 'INTERNAL',
      message: 'We could not save your enquiry. Please try again.',
      submissionKey: validated.submissionKey
    };
  }

  var notifications = {
    customer: { ok: true, skipped: true, status: 'not-run' },
    owner: { ok: true, skipped: true, status: 'not-run' },
    whatsapp: { ok: true, skipped: true, status: 'disabled' }
  };

  if (!saved.duplicate) {
    notifications = dispatchNotifications_(saved);
    updateNotificationStatus(saved, notifications);
  } else if (saved.retry && (saved.retry.owner || saved.retry.customer) && claimRetry_(validated.submissionKey)) {
    notifications = dispatchNotifications_(saved, saved.retry);
    updateNotificationStatus(saved, notifications);
  }

  return {
    ok: true,
    duplicate: saved.duplicate === true,
    reference: saved.reference,
    status: STATUS.RECEIVED,
    submissionKey: validated.submissionKey,
    message: 'Thank you. Your enquiry has been received. Your reference is ' + saved.reference + '. This is not a confirmed booking.',
    notifications: notifications
  };
}

function validateEnquiry(data) {
  data = data || {};

  if (cleanText_(data.fax_number, 200)) {
    return { ok: false, message: 'Check the enquiry and try again.', logDetail: 'A honeypot field was completed.' };
  }

  var name = cleanText_(data.name, 120);
  if (!name) return { ok: false, message: 'Enter your full name.', logDetail: 'Name was missing.' };
  if (name.length < 2) return { ok: false, message: 'Enter your full name.', logDetail: 'Name was too short.' };

  var rawEmail = String(data.email == null ? '' : data.email);
  var email = cleanText_(rawEmail, 254);
  if (email !== rawEmail.trim() || !isEmail_(email)) {
    return { ok: false, message: 'Enter a valid email address.', logDetail: 'Email was missing or invalid.' };
  }

  var phoneResult = normalisePhone(cleanText_(data.phone, 40));
  if (phoneResult.missing) return { ok: false, message: 'Enter your phone number.', logDetail: 'Phone number was missing.' };
  if (!phoneResult.ok) return { ok: false, message: 'Enter a valid phone number.', logDetail: 'Phone number was invalid.' };

  var service = cleanText_(data.service, 80);
  if (!SERVICE_VALUES.hasOwnProperty(service) || SERVICE_VALUES[service] !== true) {
    return { ok: false, message: 'Choose the service you need.', logDetail: 'Service was missing or unknown.' };
  }

  var message = cleanText_(data.message, 4000);
  if (!message) return { ok: false, message: 'Describe your project.', logDetail: 'Project description was missing.' };

  var company = cleanText_(data.business || data.company || '', 160);
  var page = cleanPage_(data.page);
  if (!page) return { ok: false, message: 'Check the enquiry and try again.', logDetail: 'Website page was invalid.' };

  var timing = formTiming_(data);
  if (!timing.ok) {
    return { ok: false, message: 'Please take a moment to review your enquiry and try again.', logDetail: timing.detail };
  }

  var submissionKey = cleanText_(data.submissionKey || data.submission_key || '', 80);
  if (!submissionKey) {
    try {
      submissionKey = Utilities.getUuid();
    } catch (uuidError) {
      return { ok: false, message: 'Check the enquiry and try again.', logDetail: 'Submission key could not be generated.' };
    }
  }
  if (!new RegExp('^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$').test(submissionKey)) {
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
    marketingConsent: marketingChoice_(data.marketingConsent),
    privacyNotice: noticeVersion_(data.privacyNotice),
    formTiming: timing.status,
    submissionKey: submissionKey,
    submittedAt: new Date()
  };
}

/**
 * The optional marketing box is unchecked by default. Only the exact value
 * the checkbox sends ("yes") counts as an opt-in. Anything else is "no".
 */
function marketingChoice_(value) {
  if (Object.prototype.toString.call(value) === '[object Array]') value = value[0];
  return String(value == null ? '' : value).trim().toLowerCase() === 'yes';
}

function noticeVersion_(value) {
  var version = cleanText_(value, 20);
  return new RegExp('^\\d{4}-\\d{2}-\\d{2}$').test(version) ? version : '';
}

/**
 * formElapsedMs is how long the form was open before submit. Absent means
 * an older website build (allowed unless REQUIRE_FORM_TIMING is true).
 * Present but empty, non-numeric, too fast or too slow is rejected.
 */
function formTiming_(data) {
  var present = Object.prototype.hasOwnProperty.call(data, 'formElapsedMs');
  if (!present) {
    if (getConfiguration().requireFormTiming) return { ok: false, detail: 'Form timing was missing.' };
    return { ok: true, status: 'absent' };
  }
  var raw = cleanText_(data.formElapsedMs, 12);
  if (!new RegExp('^\\d{1,9}$').test(raw)) return { ok: false, detail: 'Form timing was malformed.' };
  var elapsed = Number(raw);
  if (elapsed < MIN_FORM_ELAPSED_MS) return { ok: false, detail: 'Form was submitted too quickly.' };
  if (elapsed > MAX_FORM_ELAPSED_MS) return { ok: false, detail: 'Form timing was out of range.' };
  return { ok: true, status: 'ok' };
}

function generateEnquiryReference(rows, now) {
  var when = now || new Date();
  var stamp = Utilities.formatDate(when, 'Africa/Johannesburg', 'yyyyMMdd');
  var max = 0;
  for (var i = 1; i < rows.length; i++) {
    var match = new RegExp('^ISD-\\d{8}-(\\d+)$').exec(String(rows[i][0] || '').trim());
    if (!match) continue;
    var sequence = Number(match[1]);
    if (sequence > max) max = sequence;
  }
  var next = String(max + 1);
  while (next.length < 4) next = '0' + next;
  return 'ISD-' + stamp + '-' + next;
}

function saveEnquiry(data) {
  var config = getConfiguration();
  var spreadsheet;
  try {
    spreadsheet = SpreadsheetApp.openById(config.spreadsheetId);
  } catch (openError) {
    logError('SPREADSHEET_UNAVAILABLE', 'spreadsheet', '', 'The spreadsheet could not be opened.');
    return {
      ok: false,
      code: 'SPREADSHEET_UNAVAILABLE',
      message: 'We could not save your enquiry. Please try again.',
      submissionKey: data.submissionKey
    };
  }

  var leads = spreadsheet.getSheetByName(config.sheetName);
  if (!leads) {
    logError('SHEET_MISSING', 'leads', '', 'The Leads sheet is missing.', spreadsheet);
    return {
      ok: false,
      code: 'SHEET_MISSING',
      message: 'We could not save your enquiry. Please try again.',
      submissionKey: data.submissionKey
    };
  }

  if (!headersMatch_(leads, LEAD_HEADERS).ok) {
    logError('HEADER_MISMATCH', 'headers', '', 'The Leads header row does not match the expected schema.', spreadsheet);
    return {
      ok: false,
      code: 'HEADER_MISMATCH',
      message: 'We could not save your enquiry. Please try again.',
      submissionKey: data.submissionKey
    };
  }

  var width = LEAD_HEADERS.length - 1;
  var rows = leads.getRange(1, 1, leads.getMaxRows(), width).getValues();
  var existing = findSubmission_(rows, data.submissionKey);
  if (existing) {
    return {
      ok: true,
      duplicate: true,
      reference: existing.reference,
      rowNumber: existing.rowNumber,
      spreadsheet: spreadsheet,
      leads: leads,
      record: data,
      retry: notificationRetryPlan_(existing.notes)
    };
  }

  var repeated = findRecentRepeat_(rows, data);
  if (repeated) {
    noteOperational_('REPEATED_CONTENT');
    data.repeatOf = repeated.reference;
  }

  var limit = checkRateLimits_(data);
  if (!limit.ok) {
    logError('RATE_LIMIT', 'rate', '', 'An hourly enquiry limit was reached (' + limit.scope + ').', spreadsheet);
    return {
      ok: false,
      code: 'RATE_LIMIT',
      message: limit.scope === 'global'
        ? 'We are receiving a lot of enquiries. Please try again later, or call or WhatsApp 084 325 2262.'
        : 'Please wait a few minutes and try again.',
      submissionKey: data.submissionKey
    };
  }

  var reference = generateEnquiryReference(rows, data.submittedAt);
  var nextRow = nextDataRow_(rows);
  if (nextRow > leads.getMaxRows()) {
    logError('SHEET_FULL', 'write', reference, 'The Leads sheet has no empty row.', spreadsheet);
    return {
      ok: false,
      code: 'SHEET_FULL',
      message: 'We could not save your enquiry. Please try again.',
      submissionKey: data.submissionKey
    };
  }

  var notes = consentNotes_(data);
  textColumns_(leads, nextRow);
  leads.getRange(nextRow, 1, 1, width).setValues([[
    reference,
    data.submittedAt,
    asText_(data.name),
    asText_(data.email),
    data.phone,
    asText_(data.company),
    data.service,
    asText_(data.message),
    LEAD_SOURCE,
    data.page,
    data.marketingConsent ? CONSENT_REPLY_AND_MARKETING : CONSENT_REPLY_ONLY,
    SHEET_STATUS.RECEIVED,
    LEAD_PRIORITY,
    '',
    '',
    '',
    asText_(notes),
    data.submissionKey,
    data.repeatOf || '',
    asText_(data.phoneNormalised)
  ]]);

  if (formulaPrefix_(data.phone)) {
    leads.getRange(nextRow, 5).setFormula('="' + data.phone.split('"').join('""') + '"');
  }

  return {
    ok: true,
    duplicate: false,
    reference: reference,
    rowNumber: nextRow,
    spreadsheet: spreadsheet,
    leads: leads,
    record: data
  };
}

function sendCustomerAcknowledgement(data) {
  var email = buildCustomerEmail(data);
  var result = { ok: true, skipped: false, status: 'sent', channel: 'email-customer', email: email };
  if (!shouldDispatchNotifications_()) {
    result.skipped = true;
    result.status = 'skipped:test-mode';
    return result;
  }
  // The only possible recipient is the validated address on the saved
  // enquiry. Re-check it here so no other code path can widen it.
  var record = data.record || data;
  if (!isEmail_(email.to) || email.to !== record.email) {
    noteOperational_('CUSTOMER_EMAIL_RECIPIENT_REJECTED');
    result.ok = false;
    result.status = 'failed';
    return result;
  }
  var budget = customerEmailBudget_();
  if (!budget.ok) {
    noteOperational_('CUSTOMER_EMAIL_SKIPPED_' + budget.reason.toUpperCase());
    result.skipped = true;
    result.status = 'skipped:limit';
    return result;
  }
  try {
    MailApp.sendEmail({
      to: email.to,
      subject: email.subject,
      body: email.body,
      htmlBody: email.htmlBody,
      name: email.fromName,
      replyTo: email.replyTo
    });
  } catch (mailError) {
    noteOperational_('CUSTOMER_EMAIL_FAILED');
    result.ok = false;
    result.status = 'failed';
  }
  return result;
}

function notifyBusinessOwner(data) {
  var email = buildOwnerEmail(data);
  var result = { ok: true, skipped: false, status: 'sent', channel: 'email-owner', email: email };
  if (!shouldDispatchNotifications_()) {
    result.skipped = true;
    result.status = 'skipped:test-mode';
    return result;
  }
  try {
    MailApp.sendEmail({
      to: email.to,
      subject: email.subject,
      body: email.body,
      htmlBody: email.htmlBody,
      name: email.fromName
    });
  } catch (mailError) {
    noteOperational_('OWNER_EMAIL_FAILED');
    result.ok = false;
    result.status = 'failed';
  }
  return result;
}

function sendWhatsAppNotification(data) {
  var config = getConfiguration();
  if (!config.whatsappEnabled) {
    return { ok: true, skipped: true, status: 'disabled', channel: 'whatsapp' };
  }
  noteOperational_('WHATSAPP_UNAVAILABLE');
  return { ok: false, skipped: true, status: 'unavailable', channel: 'whatsapp' };
}

function getConfiguration() {
  var props = PropertiesService.getScriptProperties();
  var environment = readProp_(props, 'ENVIRONMENT').toLowerCase();
  var whatsapp = (readProp_(props, 'WHATSAPP_ENABLED') || 'false').toLowerCase();
  var origins = readProp_(props, 'ALLOWED_ORIGINS') || 'https://www.intersacks.co.za,https://intersacks.co.za';
  return {
    spreadsheetId: readProp_(props, 'SPREADSHEET_ID'),
    sheetName: readProp_(props, 'SHEET_NAME') || DEFAULT_SHEET_NAME,
    errorSheetName: readProp_(props, 'ERROR_SHEET_NAME') || DEFAULT_ERROR_SHEET,
    ownerEmail: readProp_(props, 'OWNER_EMAIL'),
    businessName: readProp_(props, 'BUSINESS_NAME') || 'InterSacks Digital',
    businessEmail: readProp_(props, 'BUSINESS_EMAIL') || 'lesleysacks1@gmail.com',
    businessPhone: readProp_(props, 'BUSINESS_PHONE') || '084 325 2262',
    environment: environment,
    acceptsSubmissions: environment === 'production',
    testMode: environment !== 'production',
    whatsappEnabled: whatsapp === 'true' || whatsapp === '1' || whatsapp === 'yes',
    requireFormTiming: (readProp_(props, 'REQUIRE_FORM_TIMING') || 'false').toLowerCase() === 'true',
    globalHourlyLimit: positiveInt_(readProp_(props, 'GLOBAL_HOURLY_LIMIT'), DEFAULT_GLOBAL_HOURLY_LIMIT),
    customerEmailHourlyLimit: positiveInt_(readProp_(props, 'CUSTOMER_EMAIL_HOURLY_LIMIT'), DEFAULT_CUSTOMER_EMAIL_HOURLY_LIMIT),
    ownerMailReserve: positiveInt_(readProp_(props, 'OWNER_MAIL_RESERVE'), DEFAULT_OWNER_MAIL_RESERVE),
    allowedOrigins: origins.split(',').map(function (item) { return item.trim(); }).filter(Boolean)
  };
}

function submissionGate_() {
  var config = getConfiguration();
  if (!config.acceptsSubmissions) {
    return {
      ok: false,
      code: 'TEST_MODE',
      message: 'External submissions are disabled while the script is in test mode.'
    };
  }
  if (config.spreadsheetId !== KNOWN_SPREADSHEET_ID) {
    return {
      ok: false,
      code: 'CONFIG',
      message: 'The enquiry spreadsheet is not configured.'
    };
  }
  if (!isEmail_(config.ownerEmail)) {
    return {
      ok: false,
      code: 'CONFIG',
      message: 'The enquiry notification address is not configured.'
    };
  }
  return { ok: true };
}

function createJsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(publicPayload_(data)))
    .setMimeType(ContentService.MimeType.JSON);
}

function createHtmlResponse(data) {
  var payload = publicPayload_(data);
  var json = JSON.stringify(payload)
    .replace(new RegExp('<', 'g'), '\\u003c')
    .replace(new RegExp('>', 'g'), '\\u003e')
    .replace(new RegExp('&', 'g'), '\\u0026')
    .replace(new RegExp('\\u2028', 'g'), '\\u2028')
    .replace(new RegExp('\\u2029', 'g'), '\\u2029');
  // Google's web-app redirect often replaces document.referrer, and the
  // HtmlService page can sit inside a nested frame. Walk every ancestor and
  // post the public payload with target "*". The contact page accepts the
  // message only from script.google.com or *.script.googleusercontent.com.
  // The payload has no email address and no spreadsheet id.
  // The Apps Script editor parses the source as HTML. A literal script tag
  // makes it report "Unexpected token ':'" further down the file.
  var html = [
    '<!doctype html><html><head><meta charset="utf-8"><' + '/head><body><' + 'script>',
    '(function(){',
    'var payload=' + json + ';',
    'var win=window;',
    'var guard=0;',
    'while(win&&guard<5){',
    'try{win.postMessage(payload,"*");}catch(e){}',
    'if(!win.parent||win.parent===win)break;',
    'win=win.parent;',
    'guard++;',
    '}',
    '})();',
    '<' + '/script><' + '/body><' + '/html>'
  ].join('');
  return HtmlService
    .createHtmlOutput(html)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function buildCustomerEmail(data) {
  var config = getConfiguration();
  var record = data.record || data;
  var reference = data.reference;
  var to = safeHeader_(record.email);
  var subject = safeHeader_('We received your enquiry (' + reference + ')');
  var body = [
    greetingLine_(record.name),
    '',
    'Thank you for contacting ' + config.businessName + '.',
    '',
    'We have received your enquiry. Your reference is ' + reference + '.',
    '',
    'This acknowledgement means we have your request on file. It is not a confirmed booking and it is not a confirmed project. We will review the details and contact you to confirm the next step.',
    '',
    'Service: ' + record.service,
    '',
    'If you need to reach us:',
    'Email: ' + config.businessEmail,
    'Phone: ' + config.businessPhone,
    'WhatsApp: ' + config.businessPhone,
    '',
    config.businessName,
    'Paarl, Western Cape'
  ].filter(function (line, index, lines) {
    return line !== '' || (lines[index - 1] !== '' && index !== 0);
  }).join('\n');

  var htmlBody = [
    '<p>' + escapeHtml_(greetingLine_(record.name)) + '</p>',
    '<p>Thank you for contacting ' + escapeHtml_(config.businessName) + '.</p>',
    '<p>We have received your enquiry. Your reference is <strong>' + escapeHtml_(reference) + '</strong>.</p>',
    '<p>This acknowledgement means we have your request on file. It is <strong>not a confirmed booking</strong> and it is not a confirmed project. We will review the details and contact you to confirm the next step.</p>',
    '<p>Service: ' + escapeHtml_(record.service) + '</p>',
    '<p>If you need to reach us:<br>',
    'Email: ' + escapeHtml_(config.businessEmail) + '<br>',
    'Phone: ' + escapeHtml_(config.businessPhone) + '<br>',
    'WhatsApp: ' + escapeHtml_(config.businessPhone) + '</p>',
    '<p>' + escapeHtml_(config.businessName) + '<br>Paarl, Western Cape</p>'
  ].join('');

  return {
    to: to,
    subject: subject,
    body: body,
    htmlBody: htmlBody,
    fromName: config.businessName,
    replyTo: config.businessEmail
  };
}

function buildOwnerEmail(data) {
  var config = getConfiguration();
  var record = data.record || data;
  var reference = data.reference;
  var to = safeHeader_(config.ownerEmail);
  var subject = safeHeader_('New enquiry ' + reference + ' requires attention');
  var body = [
    'A new website enquiry needs your attention.',
    '',
    'Reference: ' + reference,
    'Enquiry status: ' + STATUS.RECEIVED,
    'Lead status on the sheet: ' + SHEET_STATUS.RECEIVED,
    'This is not a confirmed booking. Only an authorised business action can change it to CONFIRMED.',
    '',
    'Name: ' + record.name,
    'Email: ' + record.email,
    'Phone: ' + record.phone,
    'Business: ' + (record.company || 'Not provided'),
    'Service: ' + record.service,
    'Page: ' + record.page,
    'Marketing opt-in: ' + (record.marketingConsent ? 'Yes' : 'No'),
    record.repeatOf ? 'Repeat of earlier enquiry: ' + record.repeatOf + ' (no customer acknowledgement sent)' : '',
    '',
    'Message:',
    record.message,
    '',
    'Open this lead: ' + leadSheetUrl_(config.spreadsheetId, data.rowNumber)
  ].filter(function (line, index, lines) {
    return line !== '' || (lines[index - 1] !== '' && index !== 0);
  }).join('\n');

  var sheetUrl = leadSheetUrl_(config.spreadsheetId, data.rowNumber);
  var htmlBody = [
    '<p><a href="' + escapeHtml_(sheetUrl) + '">Open this lead in the sheet</a></p>',
    '<p><strong>A new website enquiry needs your attention.</strong></p>',
    '<p>Reference: <strong>' + escapeHtml_(reference) + '</strong><br>',
    'Enquiry status: ' + STATUS.RECEIVED + '<br>',
    'Lead status on the sheet: ' + SHEET_STATUS.RECEIVED + '</p>',
    '<p>This is not a confirmed booking. Only an authorised business action can change it to CONFIRMED.</p>',
    '<p>Name: ' + escapeHtml_(record.name) + '<br>',
    'Email: ' + escapeHtml_(record.email) + '<br>',
    'Phone: ' + escapeHtml_(record.phone) + '<br>',
    'Business: ' + escapeHtml_(record.company || 'Not provided') + '<br>',
    'Service: ' + escapeHtml_(record.service) + '<br>',
    'Page: ' + escapeHtml_(record.page) + '<br>',
    'Marketing opt-in: ' + (record.marketingConsent ? 'Yes' : 'No') + '</p>',
    record.repeatOf ? '<p>Repeat of earlier enquiry: ' + escapeHtml_(record.repeatOf) + ' (no customer acknowledgement sent)</p>' : '',
    '<p>Message:</p><pre>' + escapeHtml_(record.message) + '</pre>'
  ].join('');

  return {
    to: to,
    subject: subject,
    body: body,
    htmlBody: htmlBody,
    fromName: config.businessName
  };
}

/**
 * Authorised business action. Run from the Apps Script editor.
 * Not exposed through doPost or doGet.
 */
function confirmEnquiry(reference) {
  return setLeadStatus_(reference, STATUS.CONFIRMED);
}

/**
 * Authorised business action. Run from the Apps Script editor.
 * Not exposed through doPost or doGet.
 */
function cancelEnquiry(reference) {
  return setLeadStatus_(reference, STATUS.CANCELLED);
}

/**
 * Authorised business action. Run from the Apps Script editor.
 * Not exposed through doPost or doGet.
 */
function markPendingConfirmation(reference) {
  return setLeadStatus_(reference, STATUS.PENDING_CONFIRMATION);
}

function runSafeSelfTest() {
  var results = [];
  function check(name, pass, detail) {
    results.push({ name: name, pass: !!pass, detail: String(detail || '') });
  }

  var valid = validateEnquiry({
    name: 'Test Customer',
    email: 'test-customer@example.com',
    phone: '084 325 2262',
    service: 'Web Solutions',
    message: 'Self-test enquiry. Ignore.',
    submissionKey: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    page: '/contact.html'
  });
  check('valid enquiry', valid.ok === true, valid.message || 'ok');

  var missingName = validateEnquiry({
    name: '',
    email: 'test-customer@example.com',
    phone: '084 325 2262',
    service: 'Web Solutions',
    message: 'Self-test',
    submissionKey: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
  });
  check('missing name', missingName.ok === false, missingName.message);

  var badEmail = validateEnquiry({
    name: 'Test Customer',
    email: 'not-an-email',
    phone: '084 325 2262',
    service: 'Web Solutions',
    message: 'Self-test',
    submissionKey: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
  });
  check('invalid email', badEmail.ok === false, badEmail.message);

  var missingPhone = validateEnquiry({
    name: 'Test Customer',
    email: 'test-customer@example.com',
    phone: '',
    service: 'Web Solutions',
    message: 'Self-test',
    submissionKey: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
  });
  check('missing phone', missingPhone.ok === false, missingPhone.message);

  var source = '';
  try { source = String(runSafeSelfTest); } catch (ignore) { source = ''; }
  check('editor self-test does not save a lead', source.indexOf('save' + 'Enquiry') === -1, 'validation only');
  check('editor self-test does not register a form trigger', source.indexOf('onForm' + 'Submit') === -1, 'editor self-test only');
  check('whatsapp disabled', sendWhatsAppNotification({}).status === 'disabled', 'future channel stub');
  check('address list rejected', isEmail_('a@example.com,b@example.com') === false, 'single recipient only');
  check('display name rejected', isEmail_('Name <a@example.com>') === false, 'single recipient only');
  check('control characters removed', cleanText_('A\u0000B‮C', 20) === 'A B C', 'sanitised');
  check('link in name not used as greeting', greetingLine_('Visit http://spam.example') === 'Hello,', 'fixed template');
  check('marketing defaults to no', marketingChoice_('') === false && marketingChoice_('on') === false, 'unchecked by default');

  return results;
}

function parseRequest(e) {
  if (!e) return { error: true, format: 'json', reason: 'no-event' };

  if (e.postData && typeof e.postData.contents === 'string' && e.postData.contents.length > MAX_REQUEST_CHARS) {
    return { error: true, format: 'json', reason: 'too-large' };
  }

  var fromParameters = parametersPayload_(e.parameter);
  if (fromParameters) return fromParameters;

  if (e.postData && typeof e.postData.contents === 'string') {
    var contents = e.postData.contents;
    var trimmed = contents.replace(/^\s+/, '');
    if (trimmed.charAt(0) === '{') {
      var asJson = jsonPayload_(contents);
      if (asJson) return asJson;
    }
    var fromBody = parametersPayload_(decodeForm_(contents));
    if (fromBody) return fromBody;
    var fallbackJson = jsonPayload_(contents);
    if (fallbackJson) return fallbackJson;
  }

  return { error: true, format: 'json' };
}

function jsonPayload_(contents) {
  try {
    var parsed = JSON.parse(contents);
    if (!parsed || typeof parsed !== 'object' || Object.prototype.toString.call(parsed) === '[object Array]') return null;
    var picked = pickFields_(parsed);
    if (!picked.found) return null;
    return { payload: picked.payload, format: 'json' };
  } catch (err) {
    return null;
  }
}

var ACCEPTED_FIELDS = [
  'name', 'email', 'business', 'company', 'phone', 'service', 'message',
  'page', 'submissionKey', 'submission_key', 'fax_number', 'formElapsedMs',
  'marketingConsent', 'privacyNotice', 'responseFormat'
];

/**
 * Copies only the known website fields. Unknown fields (for example
 * "status", "to", "cc", "bcc" or "ownerEmail") are dropped and can never
 * reach the sheet, an email header or a status value. Non-string values
 * are reduced to their first string element or ignored.
 */
function pickFields_(source) {
  var payload = {};
  var found = false;
  for (var i = 0; i < ACCEPTED_FIELDS.length; i++) {
    var key = ACCEPTED_FIELDS[i];
    if (!Object.prototype.hasOwnProperty.call(source, key) || source[key] == null) continue;
    var value = source[key];
    if (Object.prototype.toString.call(value) === '[object Array]') value = value[0];
    if (value == null || typeof value === 'object' || typeof value === 'function') continue;
    payload[key] = String(value);
    found = true;
  }
  return { payload: payload, found: found };
}

function parametersPayload_(parameter) {
  if (!parameter || typeof parameter !== 'object') return null;
  var picked = pickFields_(parameter);
  if (!picked.found) return null;
  var payload = picked.payload;
  var size = 0;
  for (var key in payload) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) size += payload[key].length;
  }
  if (size > MAX_REQUEST_CHARS) return { error: true, format: 'html', reason: 'too-large' };
  var format = String(payload.responseFormat || 'html').toLowerCase() === 'json' ? 'json' : 'html';
  return { payload: payload, format: format };
}

function decodeForm_(body) {
  var out = {};
  var parts = String(body || '').split('&');
  for (var i = 0; i < parts.length; i++) {
    if (!parts[i]) continue;
    var pair = parts[i].split('=');
    try {
      var key = decodeURIComponent(String(pair[0] || '').replace(/\+/g, ' '));
      var value = decodeURIComponent(String(pair.slice(1).join('=') || '').replace(/\+/g, ' '));
      out[key] = value;
    } catch (ignore) {
      return {};
    }
  }
  return out;
}

function respond_(result, format) {
  if (format === 'html') return createHtmlResponse(result);
  return createJsonResponse(result);
}

function publicPayload_(data) {
  if (data && data.ok === true) {
    var customerEmail = 'unknown';
    if (data.notifications && data.notifications.customer && data.notifications.customer.status) {
      customerEmail = String(data.notifications.customer.status);
    }
    return {
      ok: true,
      channel: CHANNEL,
      duplicate: data.duplicate === true,
      reference: String(data.reference || ''),
      status: STATUS.RECEIVED,
      customerEmail: customerEmail,
      submissionKey: String(data.submissionKey || ''),
      message: String(data.message || 'Thank you. Your enquiry has been received.')
    };
  }
  return {
    ok: false,
    channel: CHANNEL,
    code: String((data && data.code) || 'INTERNAL'),
    submissionKey: String((data && data.submissionKey) || ''),
    message: String((data && data.message) || 'We could not save your enquiry. Please try again.')
  };
}

/**
 * The owner is notified before the customer, so a MailApp quota shortage
 * or a burst of abusive enquiries cannot use up the owner's notification.
 * With a retry plan, only the channels that failed earlier are re-sent.
 */
function dispatchNotifications_(saved, plan) {
  var owner = plan && !plan.owner
    ? { ok: true, skipped: true, status: plan.ownerStatus || 'unknown' }
    : notifyBusinessOwner(saved);
  var repeat = saved && saved.record && saved.record.repeatOf;
  var customer;
  if (plan && !plan.customer) customer = { ok: true, skipped: true, status: plan.customerStatus || 'unknown' };
  else if (repeat) customer = { ok: true, skipped: true, status: 'skipped:repeat' };
  else customer = sendCustomerAcknowledgement(saved);
  return {
    customer: customer,
    owner: owner,
    whatsapp: sendWhatsAppNotification(saved)
  };
}

function updateNotificationStatus(saved, notifications) {
  if (!saved || !saved.leads || !saved.rowNumber) return;
  var customer = notifications && notifications.customer ? notifications.customer.status : 'unknown';
  var owner = notifications && notifications.owner ? notifications.owner.status : 'unknown';
  var whatsapp = notifications && notifications.whatsapp ? notifications.whatsapp.status : 'disabled';
  var line = 'Notifications: customer=' + customer + '; owner=' + owner + '; whatsapp=' + whatsapp;
  var extra = saved.duplicate && saved.retry
    ? saved.retry.evidence
    : consentNotes_(saved.record || {});
  var value = extra ? extra + ' | ' + line : line;
  try {
    saved.leads.getRange(saved.rowNumber, 17).setNumberFormat('@');
    saved.leads.getRange(saved.rowNumber, 17).setValues([[asText_(value)]]);
  } catch (ignore) {
    noteOperational_('NOTIFY_STATUS_UNSAVED');
  }
}

function setLeadStatus_(reference, enquiryStatus) {
  var sheetStatus = SHEET_STATUS[enquiryStatus];
  if (!sheetStatus) return { ok: false, code: 'VALIDATION', message: 'Unknown status.' };
  var id = cleanText_(reference, 40);
  if (!new RegExp('^ISD-\\d{8}-\\d{4}$').test(id)) return { ok: false, code: 'VALIDATION', message: 'Unknown enquiry reference.' };

  var config = getConfiguration();
  var lock = LockService.getScriptLock();
  var locked = false;
  try {
    locked = lock.tryLock(LOCK_WAIT_MS);
    if (!locked) return { ok: false, code: 'LOCKED', message: 'Please try again in a moment.' };
    var spreadsheet = SpreadsheetApp.openById(config.spreadsheetId);
    var leads = spreadsheet.getSheetByName(config.sheetName);
    if (!leads) return { ok: false, code: 'SHEET_MISSING', message: 'The Leads sheet is missing.' };
    var width = LEAD_HEADERS.length - 1;
    var rows = leads.getRange(1, 1, leads.getMaxRows(), width).getValues();
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][0] || '').trim() !== id) continue;
      leads.getRange(i + 1, 12).setValue(sheetStatus);
      return { ok: true, reference: id, status: enquiryStatus, sheetStatus: sheetStatus };
    }
    return { ok: false, code: 'NOT_FOUND', message: 'Enquiry was not found.' };
  } catch (error) {
    return { ok: false, code: 'INTERNAL', message: 'The enquiry status could not be updated.' };
  } finally {
    if (locked) {
      try { lock.releaseLock(); } catch (ignoreRelease) {}
    }
  }
}

function shouldDispatchNotifications_() {
  return !getConfiguration().testMode;
}

function leadSheetUrl_(spreadsheetId, rowNumber) {
  var url = 'https://docs.google.com/spreadsheets/d/' + spreadsheetId + '/edit';
  var row = Number(rowNumber);
  if (row > 1) url += '#range=A' + row;
  return url;
}

/**
 * Evidence written to Internal notes for each website enquiry: which
 * privacy notice version the form showed, when it was submitted, the
 * visitor's own marketing choice, and whether the form-timing check ran.
 */
function consentNotes_(data) {
  if (!data || !data.submittedAt) return '';
  var when = '';
  try {
    when = Utilities.formatDate(data.submittedAt, 'Africa/Johannesburg', "yyyy-MM-dd'T'HH:mm:ssXXX");
  } catch (ignore) {
    when = String(data.submittedAt);
  }
  return [
    'Privacy notice ' + (data.privacyNotice || 'not stated') + ' shown on form',
    'Submitted ' + when,
    'Purpose: reply to this enquiry',
    'Marketing opt-in: ' + (data.marketingConsent ? 'yes' : 'no'),
    'Form timing: ' + (data.formTiming || 'absent')
  ].concat(data.repeatOf ? ['Repeat of ' + data.repeatOf] : []).join('; ');
}

/**
 * Reads "Notifications: customer=...; owner=..." from Internal notes and
 * decides which channels may be retried. A channel that was sent, skipped
 * by a limit, or skipped in test mode is never re-sent.
 */
function notificationRetryPlan_(notes) {
  var text = String(notes || '');
  var marker = text.lastIndexOf('Notifications:');
  var evidence = marker > 0 ? text.slice(0, marker).replace(new RegExp('\\s*\\|\\s*$'), '') : (marker === 0 ? '' : text);
  var customerMatch = new RegExp('customer=([A-Za-z:-]+)').exec(text);
  var ownerMatch = new RegExp('owner=([A-Za-z:-]+)').exec(text);
  var customerStatus = customerMatch ? customerMatch[1] : '';
  var ownerStatus = ownerMatch ? ownerMatch[1] : '';
  return {
    customer: !customerStatus || customerStatus === 'failed',
    owner: !ownerStatus || ownerStatus === 'failed',
    customerStatus: customerStatus,
    ownerStatus: ownerStatus,
    evidence: evidence
  };
}

/** At most MAX_NOTIFICATION_RETRIES re-sends per submission key per hour. */
function claimRetry_(submissionKey) {
  try {
    var cache = CacheService.getScriptCache();
    var key = 'retry:' + submissionKey;
    var count = Number(cache.get(key) || '0');
    if (count >= MAX_NOTIFICATION_RETRIES) return false;
    cache.put(key, String(count + 1), 3600);
    return true;
  } catch (cacheError) {
    return false;
  }
}

/**
 * The same email, service and message within 24 hours is a repeat of an
 * earlier enquiry. It is still saved (the owner sees it), but "Duplicate
 * of" (column S) names the earlier reference, so the sheet's Counted
 * formula excludes it, and no second customer acknowledgement is sent.
 */
function findRecentRepeat_(rows, data) {
  var email = String(asText_(data.email)).toLowerCase();
  var message = asText_(data.message);
  var now = data.submittedAt ? data.submittedAt.getTime() : new Date().getTime();
  for (var i = rows.length - 1; i >= 1; i--) {
    var reference = String(rows[i][0] || '').trim();
    if (!reference) continue;
    if (String(rows[i][3] || '').toLowerCase() !== email) continue;
    if (String(rows[i][6] || '') !== data.service) continue;
    if (String(rows[i][7] || '') !== message) continue;
    var received = rows[i][1];
    var time = received instanceof Date ? received.getTime() : new Date(received).getTime();
    if (isNaN(time) || now - time > DUPLICATE_WINDOW_MS || now - time < 0) continue;
    var original = String(rows[i][18] || '').trim();
    return { reference: original || reference, rowNumber: i + 1 };
  }
  return null;
}

/**
 * Fixed-window hourly counters in CacheService. Per email and per phone
 * stop one person (or one copied address) flooding the sheet. The global
 * counter caps the whole web app, because an attacker can rotate email
 * addresses and phone numbers and Apps Script does not expose the IP.
 * If the cache is unavailable, the per-person limits fail open (a real
 * customer is not blocked) but the global limit is not counted.
 */
function checkRateLimits_(data) {
  var config = getConfiguration();
  var cache;
  try {
    cache = CacheService.getScriptCache();
  } catch (cacheError) {
    noteOperational_('RATE_LIMIT_CACHE_UNAVAILABLE');
    return { ok: true };
  }
  var bucket = hourBucket_(data.submittedAt);
  var checks = [
    { scope: 'global', key: 'rl:all:' + bucket, limit: config.globalHourlyLimit },
    { scope: 'email', key: 'rl:em:' + bucket + ':' + rateHash_(String(data.email || '').toLowerCase()), limit: RATE_LIMIT_PER_HOUR },
    { scope: 'phone', key: 'rl:ph:' + bucket + ':' + rateHash_(String(data.phoneNormalised || '')), limit: PHONE_RATE_LIMIT_PER_HOUR }
  ];
  try {
    var counts = [];
    for (var i = 0; i < checks.length; i++) {
      var count = Number(cache.get(checks[i].key) || '0');
      if (count >= checks[i].limit) return { ok: false, scope: checks[i].scope };
      counts.push(count);
    }
    for (var j = 0; j < checks.length; j++) {
      cache.put(checks[j].key, String(counts[j] + 1), 3700);
    }
  } catch (countError) {
    noteOperational_('RATE_LIMIT_CACHE_UNAVAILABLE');
  }
  return { ok: true };
}

/**
 * The customer acknowledgement is optional. It is skipped (the lead is
 * still saved and the owner still notified) when the hourly customer-email
 * cap is reached, or when MailApp's remaining daily quota is at or below
 * the reserve kept for owner notifications.
 */
function customerEmailBudget_() {
  var config = getConfiguration();
  try {
    if (typeof MailApp.getRemainingDailyQuota === 'function') {
      var remaining = Number(MailApp.getRemainingDailyQuota());
      if (!isNaN(remaining) && remaining <= config.ownerMailReserve) return { ok: false, reason: 'quota' };
    }
  } catch (quotaError) {
    return { ok: false, reason: 'quota' };
  }
  try {
    var cache = CacheService.getScriptCache();
    var key = 'rl:ack:' + hourBucket_(new Date());
    var count = Number(cache.get(key) || '0');
    if (count >= config.customerEmailHourlyLimit) return { ok: false, reason: 'hourly' };
    cache.put(key, String(count + 1), 3700);
  } catch (cacheError) {
    return { ok: false, reason: 'cache' };
  }
  return { ok: true };
}

function hourBucket_(when) {
  var date = when instanceof Date ? when : new Date();
  return String(Math.floor(date.getTime() / 3600000));
}

function positiveInt_(value, fallback) {
  var number = Number(value);
  if (!value || isNaN(number) || number < 1 || Math.floor(number) !== number) return fallback;
  return number;
}

/**
 * Greets the customer by name only when the name looks like a name. This
 * keeps visitor-controlled text (links, adverts) out of the email the web
 * app sends to the address on the enquiry.
 */
function greetingLine_(name) {
  var text = String(name == null ? '' : name);
  var plausible = new RegExp("^[\\p{L}\\p{M}][\\p{L}\\p{M} .'\u2019-]{0,59}$", 'u');
  return plausible.test(text) ? 'Hello ' + text + ',' : 'Hello,';
}

function normalisePhone(raw) {
  var original = String(raw == null ? '' : raw).trim();
  if (!original) return { ok: false, missing: true };
  if (original.length > 40) return { ok: false };
  var compact = original.replace(new RegExp('[\\s()./-]', 'g'), '');
  if (!new RegExp('^\\+?\\d+$').test(compact)) return { ok: false };
  var digits = compact.charAt(0) === '+' ? compact.slice(1) : compact;
  if (digits.length === 11 && digits.slice(0, 2) === '27') {
    var saFromIntl = digits.slice(2);
    if (!new RegExp('^[1-9][0-9]{8}$').test(saFromIntl)) return { ok: false };
    return { ok: true, original: original, normalised: '+27' + saFromIntl };
  }
  if (digits.length === 10 && digits.charAt(0) === '0') {
    var saFromLocal = digits.slice(1);
    if (!new RegExp('^[1-9][0-9]{8}$').test(saFromLocal)) return { ok: false };
    return { ok: true, original: original, normalised: '+27' + saFromLocal };
  }
  if (compact.charAt(0) === '+' && digits.length >= 8 && digits.length <= 15 && digits.charAt(0) !== '0') {
    return { ok: true, original: original, normalised: '+' + digits };
  }
  return { ok: false };
}

var INVISIBLE_CHARACTERS = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F\\u00AD\\u061C\\u180E\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u206F\\uFEFF\\uFFF9-\\uFFFB]', 'g');

/**
 * Normalises to NFC, removes control, bidi-override, zero-width and other
 * invisible formatting characters, collapses whitespace and truncates.
 * Arrays and objects are never treated as text.
 */
function cleanText_(value, maxLength) {
  if (Object.prototype.toString.call(value) === '[object Array]') value = value[0];
  if (value == null || typeof value === 'object' || typeof value === 'function') return '';
  var text = String(value);
  try {
    text = text.normalize('NFC');
  } catch (ignore) {}
  return text
    .replace(INVISIBLE_CHARACTERS, ' ')
    .replace(new RegExp('\\s+', 'g'), ' ')
    .trim()
    .slice(0, maxLength);
}

function cleanPage_(value) {
  var page = String(value == null ? '' : value).trim();
  if (!page) return '/contact.html';
  page = page.split('#')[0].split('?')[0];
  if (new RegExp('^https?:\\/\\/', 'i').test(page)) return '';
  if (page.charAt(0) !== '/') page = '/' + page;
  if (page.length > 200 || page.indexOf('//') !== -1) return '';
  if (!new RegExp('^/[A-Za-z0-9._~/-]*$').test(page)) return '';
  return page;
}

/**
 * One plain address only: an ASCII local part without quotes, commas,
 * semicolons, angle brackets or spaces, and a dotted domain with an
 * alphabetic top-level domain. Display names, address lists and quoted
 * local parts are rejected, so the value cannot add a recipient.
 */
var EMAIL_PATTERN = new RegExp(
  "^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*" +
  '@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\\.)+[A-Za-z]{2,63}$'
);

function isEmail_(value) {
  if (typeof value !== 'string' || !value || value.length > 254) return false;
  var at = value.lastIndexOf('@');
  if (at < 1 || at > 64) return false;
  return EMAIL_PATTERN.test(value);
}

function formulaPrefix_(value) {
  var lead = String(value == null ? '' : value).charAt(0);
  return lead === '=' || lead === '+' || lead === '-' || lead === '@' || lead === '\t' || lead === '\r';
}

function asText_(value) {
  var text = String(value == null ? '' : value);
  if (formulaPrefix_(text)) return "'" + text;
  return text;
}

function textColumns_(sheet, row) {
  var columns = [3, 4, 5, 6, 8, 17, 20];
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
    var reference = String(rows[i][0] || '').trim();
    var existingKey = String(rows[i][17] || '').trim();
    if (reference && existingKey === key) {
      return { rowNumber: i + 1, reference: reference, notes: String(rows[i][16] || '') };
    }
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

function rateHash_(text) {
  var hash = 0;
  for (var i = 0; i < text.length; i++) hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  return String(hash);
}

function readProp_(props, name) {
  try {
    var value = props.getProperty(name);
    return value == null ? '' : String(value).trim();
  } catch (ignore) {
    return '';
  }
}

function safeHeader_(value) {
  return String(value || '').replace(new RegExp('[\\r\\n\\u0000]+', 'g'), ' ').replace(new RegExp('\\s+', 'g'), ' ').trim();
}

function escapeHtml_(value) {
  return String(value == null ? '' : value)
    .replace(new RegExp('&', 'g'), '&amp;')
    .replace(new RegExp('<', 'g'), '&lt;')
    .replace(new RegExp('>', 'g'), '&gt;')
    .replace(new RegExp('"', 'g'), '&quot;');
}

function safeDetail_(text) {
  var config = getConfiguration();
  var detail = String(text || '').replace(new RegExp('\\s+', 'g'), ' ').trim();
  detail = detail.replace(new RegExp('[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}', 'gi'), '[redacted]');
  detail = detail.replace(new RegExp('\\+?\\d[\\d\\s().-]{6,}\\d', 'g'), '[redacted]');
  if (config.spreadsheetId && detail.indexOf(config.spreadsheetId) !== -1) {
    detail = detail.split(config.spreadsheetId).join('[redacted]');
  }
  if (detail.length > 180) detail = detail.slice(0, 180);
  return detail;
}

function noteOperational_(label) {
  try {
    console.log('Enquiry event: ' + label);
  } catch (ignore) {}
}

function logError(code, stage, leadId, detail, spreadsheet) {
  var logLock = null;
  var logLocked = false;
  try {
    logLock = LockService.getUserLock();
    logLocked = logLock.tryLock(ERROR_LOG_LOCK_WAIT_MS);
    if (!logLocked) {
      noteOperational_('ERROR_LOG_UNLOCKED');
      return;
    }
    var config = getConfiguration();
    var book = spreadsheet;
    if (!book) book = SpreadsheetApp.openById(config.spreadsheetId);
    var sheet = book.getSheetByName(config.errorSheetName);
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
    noteOperational_('ERROR_LOG_FAILED');
  } finally {
    if (logLocked) {
      try { logLock.releaseLock(); } catch (ignoreRelease) {}
    }
  }
}
