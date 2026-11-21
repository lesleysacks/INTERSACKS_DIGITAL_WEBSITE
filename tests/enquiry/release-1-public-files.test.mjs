/**
 * Release 1 static checks: what GitHub Pages publishes, the privacy notice
 * against the real implementation, the contact form's consent controls, and
 * the Content Security Policy meta tags. Reads files only.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (file) => readFileSync(root + file, 'utf8');
const SITE_PAGES = ['index.html', 'about.html', 'services.html', 'work.html', 'resources.html', 'process.html', 'contact.html', 'privacy.html', 'payments.html', '404.html'];

// GitHub Pages publishes every tracked file except dot-files (Jekyll default).
function publishedFiles() {
  const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
  return tracked.filter((file) => !file.split('/').some((part) => part.startsWith('.') || part.startsWith('_')));
}

test('no personal documents, backups, keys or environment files are published', () => {
  const files = publishedFiles();
  const risky = files.filter((file) => /\.(pdf|docx?|xlsx?|csv|bak|orig|old|tmp|swp|pem|key|p12|pfx|sql|sqlite|zip|log)$/i.test(file) || /(^|\/)cv[ ._-]|curriculum|resume/i.test(file));
  assert.deepEqual(risky, []);
  assert.equal(existsSync(root + 'assets/L.S CV 2026.pdf'), false);
  assert.equal(existsSync(root + 'assets/L.S CV 2026.docx'), false);
  const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n');
  assert.equal(tracked.some((file) => /(^|\/)\.env$/.test(file)), false);
});

test('no credentials or private keys appear in published text files', () => {
  const patterns = [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    /AKIA[0-9A-Z]{16}/,
    /AIza[0-9A-Za-z_-]{35}/,
    /gh[pousr]_[0-9A-Za-z]{36}/,
    /xox[abpr]-[0-9A-Za-z-]{10,}/,
    /sk_live_[0-9A-Za-z]{16,}/,
    /(PAYFAST_PASSPHRASE|PAYPAL_CLIENT_SECRET|PAYFAST_MERCHANT_KEY)\s*=\s*(?!your_)[^\s]+/
  ];
  for (const file of publishedFiles()) {
    if (!/\.(html|js|mjs|gs|json|md|txt|xml|css|toml|example)$/i.test(file)) continue;
    const text = read(file);
    for (const pattern of patterns) assert.equal(pattern.test(text), false, `${file} matches ${pattern}`);
  }
});

test('the contact form offers an optional, unchecked marketing choice and a privacy link', () => {
  const page = read('contact.html');
  const box = /<input[^>]*name="marketingConsent"[^>]*>/.exec(page);
  assert.ok(box, 'marketing checkbox');
  assert.match(box[0], /type="checkbox"/);
  assert.match(box[0], /value="yes"/);
  assert.doesNotMatch(box[0], /\bchecked\b/);
  assert.doesNotMatch(box[0], /\brequired\b/);
  assert.match(page, /name="privacyNotice" value="\d{4}-\d{2}-\d{2}"/);
  assert.match(page, /name="formElapsedMs"/);
  assert.match(page, /href="privacy\.html#enquiries"/);
  assert.match(page, /Optional:/);
});

test('the privacy notice matches what the code does', () => {
  const privacy = read('privacy.html');
  const id = /var MEASUREMENT_ID = '(G-[A-Z0-9]+)'/.exec(read('js/analytics.js'))[1];
  assert.equal(id, 'G-XCN1MN0GHR');
  assert.ok(privacy.includes(id));
  assert.equal((privacy.match(/G-[A-Z0-9]{6,}/g) || []).every((value) => value === id), true);
  for (const event of ['whatsapp_click', 'email_click', 'phone_click', 'quote_request_click', 'service_view', 'contact_page_view', 'generate_lead']) {
    assert.ok(privacy.includes(event), event);
    assert.ok(read('js/analytics.js').includes(event) || event === 'generate_lead', event);
  }
  for (const phrase of ['id="enquiries"', 'Google Apps Script', 'Google Sheets', 'Gmail', 'outside South Africa', 'Information Regulator', 'Your rights', 'correct', 'delete', 'withdraw', 'not sent to Google Analytics', 'Google signals and ad personalisation are switched off']) {
    assert.ok(privacy.includes(phrase), phrase);
  }
  assert.doesNotMatch(privacy, /we comply|POPIA compliant|fully compliant|cookies are disabled|consent mode/i);
  // The notice says the payments notice, 404 page and greeting cards do not load the tag.
  for (const file of ['payments.html', '404.html', 'assets/templates/greeting-cards/birthday-card-template.html', 'assets/templates/greeting-cards/valentine-card-template.html']) {
    assert.equal(read(file).includes('analytics.js'), false, file);
  }
  // The notice version on the form matches the notice's date.
  const version = /name="privacyNotice" value="(\d{4})-(\d{2})-(\d{2})"/.exec(read('contact.html'));
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  assert.ok(privacy.includes(`Updated ${Number(version[3])} ${months[Number(version[2]) - 1]} ${version[1]}.`));
});

test('every placeholder in the privacy notice is listed in the owner actions report', () => {
  const placeholders = read('privacy.html').match(/\[OWNER TO CONFIRM: [^\]]+\]/g) || [];
  const actions = read('docs/releases/RELEASE_1_OWNER_ACTIONS.md');
  for (const placeholder of placeholders) assert.ok(actions.includes(placeholder), placeholder);
});

test('site pages carry one CSP that keeps the enquiry form unrestricted and blocks inline script', () => {
  for (const page of SITE_PAGES) {
    const html = read(page);
    const metas = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/g) || [];
    assert.equal(metas.length, 1, page);
    const policy = /content="([^"]+)"/.exec(metas[0])[1];
    assert.match(policy, /script-src 'self' https:\/\/\*\.googletagmanager\.com;/, page);
    assert.doesNotMatch(policy, /script-src[^;]*'unsafe-(inline|eval)'/, page);
    assert.match(policy, /object-src 'none'/, page);
    assert.match(policy, /base-uri 'self'/, page);
    assert.doesNotMatch(policy, /form-action|frame-src|default-src|child-src|navigate-to/, page);
    assert.match(html, /<meta name="referrer" content="strict-origin-when-cross-origin">/, page);
    assert.doesNotMatch(html, /\son[a-z]+="/i, `${page} has an inline event handler`);
    assert.equal(/<script(?![^>]*(\bsrc=|type="application\/ld\+json"))[^>]*>/i.test(html), false, `${page} has an inline script`);
    assert.ok(html.indexOf('Content-Security-Policy') < html.indexOf('<script'), `${page}: CSP must come before the first script`);
  }
});
