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
 */

var KNOWN_SPREADSHEET_ID = '1N2xHXT2t28CdSBkZFihbOxgk9H3kK2-8n0QK2kXrW4M';
var DEFAULT_SHEET_NAME = 'Leads';
var DEFAULT_ERROR_SHEET = 'Error Log';
var LEAD_SOURCE = 'Website \u2013 Contact form';
var LOCK_WAIT_MS = 15000;
var ERROR_LOG_LOCK_WAIT_MS = 5000;
var RATE_LIMIT_PER_HOUR = 20;
var CHANNEL = 'intersacks-enquiry';

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
    noteOperational_('INVALID_JSON');
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

  if (!saved.duplicate || saved.needsNotificationRetry) {
    notifications = dispatchNotifications_(saved);
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

  if (String(data.fax_number || '').trim()) {
    return { ok: false, message: 'Check the enquiry and try again.', logDetail: 'A honeypot field was completed.' };
  }

  var name = cleanText_(data.name, 120);
  if (!name) return { ok: false, message: 'Enter your full name.', logDetail: 'Name was missing.' };
  if (name.length < 2) return { ok: false, message: 'Enter your full name.', logDetail: 'Name was too short.' };

  var email = cleanText_(data.email, 254);
  if (!isEmail_(email)) return { ok: false, message: 'Enter a valid email address.', logDetail: 'Email was missing or invalid.' };

  var phoneResult = normalisePhone(data.phone);
  if (phoneResult.missing) return { ok: false, message: 'Enter your phone number.', logDetail: 'Phone number was missing.' };
  if (!phoneResult.ok) return { ok: false, message: 'Enter a valid phone number.', logDetail: 'Phone number was invalid.' };

  var service = cleanText_(data.service, 80);
  if (!SERVICE_VALUES[service]) {
    return { ok: false, message: 'Choose the service you need.', logDetail: 'Service was missing or unknown.' };
  }

  var message = cleanText_(data.message, 4000);
  if (!message) return { ok: false, message: 'Describe your project.', logDetail: 'Project description was missing.' };

  var company = cleanText_(data.business || data.company || '', 160);
  var page = cleanPage_(data.page);
  if (!page) return { ok: false, message: 'Check the enquiry and try again.', logDetail: 'Website page was invalid.' };

  var bookingDate = cleanText_(data.bookingDate || data.booking_date || '', 40);
  var bookingDetails = cleanText_(data.bookingDetails || data.booking_details || '', 500);

  var submissionKey = cleanText_(data.submissionKey || data.submission_key || '', 80);
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
    bookingDate: bookingDate,
    bookingDetails: bookingDetails,
    submissionKey: submissionKey,
    submittedAt: new Date()
  };
}

function generateEnquiryReference(rows, now) {
  var when = now || new Date();
  var stamp = Utilities.formatDate(when, 'Africa/Johannesburg', 'yyyyMMdd');
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
      needsNotificationRetry: notificationNeedsRetry_(existing.notes)
    };
  }

  if (!withinRateLimit_(data.email)) {
    logError('RATE_LIMIT', 'rate', '', 'The hourly enquiry limit was reached.', spreadsheet);
    return {
      ok: false,
      code: 'RATE_LIMIT',
      message: 'Please wait a few minutes and try again.',
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

  var notes = bookingNotes_(data);
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
    'Yes',
    SHEET_STATUS.RECEIVED,
    LEAD_PRIORITY,
    '',
    '',
    '',
    asText_(notes),
    data.submissionKey,
    '',
    asText_(data.phoneNormalised)
  ]]);

  if (/^[=+\-@]/.test(data.phone)) {
    leads.getRange(nextRow, 5).setFormula('="' + data.phone.replace(/"/g, '""') + '"');
  }

  return {
    ok: true,
    duplicate: false,
    reference: reference,
    rowNumber: nextRow,
    spreadsheet: spreadsheet,
    leads: leads,
    record: data,
    needsNotificationRetry: true
  };
}

function sendCustomerAcknowledgement(data) {
  var email = buildCustomerEmail(data);
  if (!shouldDispatchNotifications_()) {
    return { ok: true, skipped: true, status: 'skipped:test-mode', channel: 'email-customer', email: email };
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
    return { ok: true, skipped: false, status: 'sent', channel: 'email-customer', email: email };
  } catch (mailError) {
    noteOperational_('CUSTOMER_EMAIL_FAILED');
    return { ok: false, skipped: false, status: 'failed', channel: 'email-customer', email: email };
  }
}

function notifyBusinessOwner(data) {
  var email = buildOwnerEmail(data);
  if (!shouldDispatchNotifications_()) {
    return { ok: true, skipped: true, status: 'skipped:test-mode', channel: 'email-owner', email: email };
  }
  try {
    MailApp.sendEmail({
      to: email.to,
      subject: email.subject,
      body: email.body,
      htmlBody: email.htmlBody,
      name: email.fromName
    });
    return { ok: true, skipped: false, status: 'sent', channel: 'email-owner', email: email };
  } catch (mailError) {
    noteOperational_('OWNER_EMAIL_FAILED');
    return { ok: false, skipped: false, status: 'failed', channel: 'email-owner', email: email };
  }
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
  var environment = (readProp_(props, 'ENVIRONMENT') || 'production').toLowerCase();
  var whatsapp = (readProp_(props, 'WHATSAPP_ENABLED') || 'false').toLowerCase();
  var origins = readProp_(props, 'ALLOWED_ORIGINS') || 'https://www.intersacks.co.za,https://intersacks.co.za';
  return {
    spreadsheetId: readProp_(props, 'SPREADSHEET_ID') || KNOWN_SPREADSHEET_ID,
    sheetName: readProp_(props, 'SHEET_NAME') || DEFAULT_SHEET_NAME,
    errorSheetName: readProp_(props, 'ERROR_SHEET_NAME') || DEFAULT_ERROR_SHEET,
    ownerEmail: readProp_(props, 'OWNER_EMAIL') || 'lesleysacks1@gmail.com',
    businessName: readProp_(props, 'BUSINESS_NAME') || 'InterSacks Digital',
    businessEmail: readProp_(props, 'BUSINESS_EMAIL') || 'lesleysacks1@gmail.com',
    businessPhone: readProp_(props, 'BUSINESS_PHONE') || '084 325 2262',
    environment: environment,
    testMode: environment === 'test' || environment === 'development',
    whatsappEnabled: whatsapp === 'true' || whatsapp === '1' || whatsapp === 'yes',
    allowedOrigins: origins.split(',').map(function (item) { return item.trim(); }).filter(Boolean)
  };
}

function createJsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(publicPayload_(data)))
    .setMimeType(ContentService.MimeType.JSON);
}

function createHtmlResponse(data) {
  var payload = publicPayload_(data);
  var json = JSON.stringify(payload)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
  var allowed = JSON.stringify(getConfiguration().allowedOrigins);
  var html = [
    '<!doctype html><html><head><meta charset="utf-8"></head><body><script>',
    '(function(){',
    'var payload=' + json + ';',
    'var allowed=' + allowed + ';',
    'var referrer="";',
    'try{referrer=document.referrer||"";}catch(e){}',
    'var target="";',
    'for(var i=0;i<allowed.length;i++){if(referrer.indexOf(allowed[i])===0){target=allowed[i];break;}}',
    'if(!target){target=allowed[0]||"*";}',
    'try{window.top.postMessage(payload,target);}catch(e){}',
    '})();',
    '<\/script></body></html>'
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
    'Hello ' + record.name + ',',
    '',
    'Thank you for contacting ' + config.businessName + '.',
    '',
    'We have received your enquiry. Your reference is ' + reference + '.',
    '',
    'This acknowledgement means we have your request on file. It is not a confirmed booking and it is not a confirmed project. We will review the details and contact you to confirm the next step.',
    '',
    'Service: ' + record.service,
    record.bookingDate ? 'Requested date: ' + record.bookingDate : '',
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
    '<p>Hello ' + escapeHtml_(record.name) + ',</p>',
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
    record.bookingDate ? 'Requested date: ' + record.bookingDate : '',
    record.bookingDetails ? 'Booking details: ' + record.bookingDetails : '',
    '',
    'Message:',
    record.message,
    '',
    'Spreadsheet: https://docs.google.com/spreadsheets/d/' + config.spreadsheetId + '/edit'
  ].filter(function (line, index, lines) {
    return line !== '' || (lines[index - 1] !== '' && index !== 0);
  }).join('\n');

  var htmlBody = [
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
    'Page: ' + escapeHtml_(record.page) + '</p>',
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
  check('no onFormSubmit trigger in this function', source.indexOf('onFormSubmit') === -1, 'editor self-test only');
  check('whatsapp disabled', sendWhatsAppNotification({}).status === 'disabled', 'future channel stub');

  return results;
}

function parseRequest(e) {
  if (!e) return { error: true, format: 'json' };

  if (e.postData && typeof e.postData.contents === 'string') {
    var type = String(e.postData.type || '').toLowerCase();
    if (type.indexOf('application/json') !== -1 || type.indexOf('text/plain') !== -1) {
      try {
        var parsed = JSON.parse(e.postData.contents);
        if (!parsed || typeof parsed !== 'object' || Object.prototype.toString.call(parsed) === '[object Array]') {
          return { error: true, format: 'json' };
        }
        return { payload: parsed, format: 'json' };
      } catch (err) {
        return { error: true, format: 'json' };
      }
    }
  }

  if (e.parameter && typeof e.parameter === 'object') {
    var payload = {};
    var keys = [
      'name', 'email', 'business', 'company', 'phone', 'service', 'message',
      'page', 'submissionKey', 'submission_key', 'fax_number', 'bookingDate',
      'booking_date', 'bookingDetails', 'booking_details', 'status', 'responseFormat'
    ];
    for (var i = 0; i < keys.length; i++) {
      if (e.parameter[keys[i]] != null) payload[keys[i]] = e.parameter[keys[i]];
    }
    var format = String(payload.responseFormat || 'html').toLowerCase() === 'json' ? 'json' : 'html';
    return { payload: payload, format: format };
  }

  return { error: true, format: 'json' };
}

function respond_(result, format) {
  if (format === 'html') return createHtmlResponse(result);
  return createJsonResponse(result);
}

function publicPayload_(data) {
  if (data && data.ok === true) {
    return {
      ok: true,
      channel: CHANNEL,
      duplicate: data.duplicate === true,
      reference: String(data.reference || ''),
      status: STATUS.RECEIVED,
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

function dispatchNotifications_(saved) {
  return {
    customer: sendCustomerAcknowledgement(saved),
    owner: notifyBusinessOwner(saved),
    whatsapp: sendWhatsAppNotification(saved)
  };
}

function updateNotificationStatus(saved, notifications) {
  if (!saved || !saved.leads || !saved.rowNumber) return;
  var customer = notifications && notifications.customer ? notifications.customer.status : 'unknown';
  var owner = notifications && notifications.owner ? notifications.owner.status : 'unknown';
  var whatsapp = notifications && notifications.whatsapp ? notifications.whatsapp.status : 'disabled';
  var line = 'Notifications: customer=' + customer + '; owner=' + owner + '; whatsapp=' + whatsapp;
  var extra = bookingNotes_(saved.record || {});
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
  if (!/^ISD-\d{8}-\d{4}$/.test(id)) return { ok: false, code: 'VALIDATION', message: 'Unknown enquiry reference.' };

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

function bookingNotes_(data) {
  var parts = [];
  if (data && data.bookingDate) parts.push('Requested date: ' + data.bookingDate);
  if (data && data.bookingDetails) parts.push(data.bookingDetails);
  return parts.join(' | ');
}

function notificationNeedsRetry_(notes) {
  var text = String(notes || '');
  if (!text) return true;
  if (text.indexOf('customer=failed') !== -1 || text.indexOf('owner=failed') !== -1) return true;
  if (text.indexOf('customer=sent') !== -1 && text.indexOf('owner=sent') !== -1) return false;
  if (text.indexOf('skipped:test-mode') !== -1) return false;
  return true;
}

function normalisePhone(raw) {
  var original = String(raw == null ? '' : raw).trim();
  if (!original) return { ok: false, missing: true };
  if (original.length > 40) return { ok: false };
  var compact = original.replace(/[\s()./-]/g, '');
  if (!/^\+?\d+$/.test(compact)) return { ok: false };
  var digits = compact.charAt(0) === '+' ? compact.slice(1) : compact;
  if (digits.length === 11 && digits.slice(0, 2) === '27') {
    var saFromIntl = digits.slice(2);
    if (!/^[1-9][0-9]{8}$/.test(saFromIntl)) return { ok: false };
    return { ok: true, original: original, normalised: '+27' + saFromIntl };
  }
  if (digits.length === 10 && digits.charAt(0) === '0') {
    var saFromLocal = digits.slice(1);
    if (!/^[1-9][0-9]{8}$/.test(saFromLocal)) return { ok: false };
    return { ok: true, original: original, normalised: '+27' + saFromLocal };
  }
  if (compact.charAt(0) === '+' && digits.length >= 8 && digits.length <= 15 && digits.charAt(0) !== '0') {
    return { ok: true, original: original, normalised: '+' + digits };
  }
  return { ok: false };
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
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value) && value.indexOf('..') === -1;
}

function asText_(value) {
  var text = String(value == null ? '' : value);
  if (/^[=+\-@]/.test(text)) return "'" + text;
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

function withinRateLimit_(email) {
  try {
    var cache = CacheService.getScriptCache();
    var key = 'lead-rate:' + rateHash_(String(email || '').toLowerCase());
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

function readProp_(props, name) {
  try {
    var value = props.getProperty(name);
    return value == null ? '' : String(value).trim();
  } catch (ignore) {
    return '';
  }
}

function safeHeader_(value) {
  return String(value || '').replace(/[\r\n\0]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function escapeHtml_(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function safeDetail_(text) {
  var config = getConfiguration();
  var detail = String(text || '').replace(/\s+/g, ' ').trim();
  detail = detail.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted]');
  detail = detail.replace(/\+?\d[\d\s().-]{6,}\d/g, '[redacted]');
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
