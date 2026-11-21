/*
 * Release 1 browser checks (Chromium via Playwright).
 *
 * What this proves, and what it does not:
 *   - Pages are served from this checkout but under the production hostname
 *     (https://www.intersacks.co.za), so js/analytics.js loads the real
 *     Google tag and the Content Security Policy is exercised as in
 *     production.
 *   - Every request to Google Apps Script is answered by an in-test mock that
 *     imitates its postMessage reply. No enquiry reaches the live Apps Script, the
 *     spreadsheet, or anyone's inbox.
 *   - Every Google Analytics collection request is aborted, so no test hit
 *     reaches the GA4 property. Measurement is read from window.dataLayer.
 *   - A passing run is NOT evidence that the live Apps Script deployment
 *     works. Only an approved, real enquiry on the live site shows that.
 *
 * Run:  node tests/browser/release-1-browser.mjs
 * Needs Playwright with Chromium available to Node (not a project dependency).
 */
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const root = fileURLToPath(new URL('../../', import.meta.url));
const ORIGIN = 'https://www.intersacks.co.za';
const PAGES = ['index.html', 'about.html', 'services.html', 'work.html', 'resources.html', 'process.html', 'contact.html', 'privacy.html', 'payments.html', '404.html'];
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg', '.png': 'image/png', '.txt': 'text/plain', '.xml': 'application/xml' };
const PII = ['Audit Tester', 'audit.tester@example.com', '082 555 0101', '0825550101', 'Tester Studio', 'confidential project text'];

const failures = [];
const passes = [];
const check = (name, ok, detail = '') => (ok ? passes : failures).push(detail ? `${name}: ${detail}` : name);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const blocked = { analytics: 0, appsScriptPosts: [] };

await context.route('**/*', async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  const host = url.hostname;

  if (url.origin === ORIGIN) {
    const relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname).replace(/^\/+/, '');
    const file = normalize(join(root, relative));
    if (!file.startsWith(root)) return route.fulfill({ status: 403, body: 'forbidden' });
    try {
      const body = await readFile(file);
      return route.fulfill({ status: 200, body, headers: { 'content-type': TYPES[extname(file)] || 'application/octet-stream' } });
    } catch {
      return route.fulfill({ status: 404, body: await readFile(join(root, '404.html')), headers: { 'content-type': TYPES['.html'] } });
    }
  }

  if (host === 'script.google.com' || host.endsWith('googleusercontent.com')) {
    // Live Apps Script answers a POST with a redirect to a
    // *-script.googleusercontent.com sandbox page. Playwright cannot fulfil a
    // redirect for an iframe form POST, so the mock answers directly from
    // script.google.com, which the form also trusts. The CSP added in
    // Release 1 does not restrict forms or frames, so the redirect hop is
    // not affected by it.
    const fields = Object.fromEntries(new URLSearchParams(request.postData() || ''));
    blocked.appsScriptPosts.push(fields);
    const payload = { ok: true, channel: 'intersacks-enquiry', duplicate: false, reference: 'ISD-20261121-0042', status: 'RECEIVED', customerEmail: 'sent', submissionKey: fields.submissionKey || '', message: 'Thank you.' };
    const html = `<!doctype html><html><body><script>(function(){var w=window,g=0;while(w&&g<5){try{w.postMessage(${JSON.stringify(payload)},"*")}catch(e){}if(!w.parent||w.parent===w)break;w=w.parent;g++}})();<\/script></body></html>`;
    return route.fulfill({ status: 200, body: html, headers: { 'content-type': 'text/html' } });
  }

  if (/(^|\.)google-analytics\.com$|(^|\.)analytics\.google\.com$/.test(host) || (host === 'www.googletagmanager.com' && !url.pathname.startsWith('/gtag/js'))) {
    blocked.analytics += 1;
    return route.abort();
  }

  return route.continue();
});

async function open(path) {
  const page = await context.newPage();
  const violations = [];
  const errors = [];
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      window.__cspViolations.push(`${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && /Content Security Policy/i.test(message.text())) violations.push(message.text());
  });
  await page.goto(`${ORIGIN}/${path}`, { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  const seen = await page.evaluate(() => window.__cspViolations);
  return { page, violations: violations.concat(seen), errors };
}

// 1. CSP: no violations and no script errors on every site page.
for (const path of PAGES) {
  const { page, violations, errors } = await open(path);
  const meta = await page.evaluate(() => document.querySelectorAll('meta[http-equiv="Content-Security-Policy"]').length);
  check(`${path} has one CSP meta tag`, meta === 1, String(meta));
  check(`${path} has no CSP violations`, violations.length === 0, violations.join(' | '));
  check(`${path} has no script errors`, errors.length === 0, errors.join(' | '));
  if (path === 'index.html') {
    const gtagLoaded = await page.evaluate(() => !!document.querySelector('script[src*="googletagmanager.com/gtag/js"]'));
    check('index.html injects the Google tag on the production host', gtagLoaded);
    const config = await page.evaluate(() => (window.dataLayer || []).map((item) => Array.from(item)).find((item) => item[0] === 'config'));
    check('GA4 config uses the active measurement ID', config && config[1] === 'G-XCN1MN0GHR', JSON.stringify(config));
    check('GA4 config turns off Google signals and ad personalisation', config && config[2] && config[2].allow_google_signals === false && config[2].allow_ad_personalization_signals === false, JSON.stringify(config && config[2]));
  }
  await page.close();
}

// 2. Enquiry journey with the mocked Apps Script, under the CSP.
const { page, violations, errors } = await open('contact.html');
const marketing = await page.locator('input[name="marketingConsent"]');
check('marketing box exists and is unchecked by default', (await marketing.count()) === 1 && !(await marketing.isChecked()));
check('marketing box is not required', (await marketing.getAttribute('required')) === null);
check('privacy summary links to the enquiry section', (await page.locator('#privacy-summary a[href="privacy.html#enquiries"]').count()) === 1);

await page.fill('[name=name]', 'Audit Tester');
await page.fill('[name=email]', 'audit.tester@example.com');
await page.fill('[name=business]', 'Tester Studio');
await page.fill('[name=phone]', '082 555 0101');
await page.check('input[name="service"][value="Branding"]', { force: true });
await page.fill('[name=message]', 'confidential project text');
await page.waitForTimeout(3200);
await page.click('#contact-form button[type=submit]');
await page.waitForFunction(() => /ISD-20261121-0042/.test(document.querySelector('#form-status').textContent), null, { timeout: 15000 }).catch(() => {});

const status = await page.textContent('#form-status');
check('success is shown only with the reference from the backend', /ISD-20261121-0042/.test(status), status);
check('exactly one POST reached the (mocked) Apps Script', blocked.appsScriptPosts.length === 1, String(blocked.appsScriptPosts.length));
const posted = blocked.appsScriptPosts[0] || {};
check('form sends formElapsedMs >= 3000', Number(posted.formElapsedMs) >= 3000, posted.formElapsedMs);
check('form sends the privacy notice version', posted.privacyNotice === '2026-11-21', posted.privacyNotice);
check('unchecked marketing box is not sent as consent', !('marketingConsent' in posted), JSON.stringify(posted.marketingConsent));
check('honeypot is sent empty', posted.fax_number === '', JSON.stringify(posted.fax_number));
check('no CSP violations during the enquiry journey', violations.length === 0, violations.join(' | '));
check('no script errors during the enquiry journey', errors.length === 0, errors.join(' | '));

const events = await page.evaluate(() => (window.dataLayer || []).map((item) => Array.from(item)).filter((item) => item[0] === 'event').map((item) => ({ name: item[1], params: item[2] })));
const leads = events.filter((event) => event.name === 'generate_lead');
check('one generate_lead event after the confirmed save', leads.length === 1, JSON.stringify(leads));
check('generate_lead carries only allowed parameters', leads.every((event) => Object.keys(event.params).every((key) => ['page_path', 'service_name', 'link_location', 'transport_type'].includes(key))), JSON.stringify(leads));
check('generate_lead service is Branding', leads[0] && leads[0].params.service_name === 'Branding');
const serialised = JSON.stringify(events);
check('no personal information in any analytics event', PII.every((value) => !serialised.includes(value)) && !serialised.includes('ISD-'), serialised);

// A second message for the same reference must not add a second lead event.
await page.evaluate(() => window.dispatchEvent(new CustomEvent('intersacks:lead-confirmed', { detail: { reference: 'ISD-20261121-0042', service: 'Branding' } })));
const leadCount = await page.evaluate(() => (window.dataLayer || []).filter((item) => item[0] === 'event' && item[1] === 'generate_lead').length);
check('a repeated confirmation does not add a second generate_lead', leadCount === 1, String(leadCount));
await page.close();

// 3. Marketing opt-in is sent only when ticked.
const second = await open('contact.html');
await second.page.fill('[name=name]', 'Audit Tester');
await second.page.fill('[name=email]', 'audit.tester@example.com');
await second.page.fill('[name=phone]', '082 555 0101');
await second.page.check('input[name="service"][value="Web Solutions"]', { force: true });
await second.page.fill('[name=message]', 'confidential project text');
await second.page.check('input[name="marketingConsent"]');
await second.page.waitForTimeout(3200);
await second.page.click('#contact-form button[type=submit]');
await second.page.waitForFunction(() => /ISD-/.test(document.querySelector('#form-status').textContent), null, { timeout: 15000 }).catch(() => {});
const optIn = blocked.appsScriptPosts[1] || {};
check('ticked marketing box is sent as "yes"', optIn.marketingConsent === 'yes', JSON.stringify(optIn.marketingConsent));
await second.page.close();

// 4. Resource search: Enter filters in place and does not reload the page.
const resources = await open('resources.html');
await resources.page.evaluate(() => { window.__notReloaded = true; });
await resources.page.fill('#resource-search', 'invoice');
await resources.page.press('#resource-search', 'Enter');
await resources.page.waitForTimeout(500);
check('resource search Enter does not reload the page', await resources.page.evaluate(() => window.__notReloaded === true));
check('resource search has no CSP violations', resources.violations.length === 0, resources.violations.join(' | '));
await resources.page.close();

// 5. The removed CV is no longer served.
const cv = await context.newPage();
const response = await cv.goto(`${ORIGIN}/assets/L.S%20CV%202026.pdf`);
check('the personal CV is not published', response.status() === 404, String(response.status()));
await cv.close();

await browser.close();
console.log(`Analytics requests blocked during the run: ${blocked.analytics}`);
console.log(`${passes.length} browser checks passed.`);
if (failures.length) {
  console.error(`${failures.length} browser checks failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
