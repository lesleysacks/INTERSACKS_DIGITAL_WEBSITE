/*
 * Repeatable browser checks for the credibility-fix release.
 *
 * Prerequisites:
 *   1. Serve the repository at http://127.0.0.1:4175.
 *   2. Start Chromium with --remote-debugging-port=9235.
 *   3. Run with Node 22+:
 *      node tests/browser-smoke-tests.mjs
 */

const baseUrl = process.env.SITE_URL || 'http://127.0.0.1:4175';
const devtoolsUrl = process.argv[2] || process.env.DEVTOOLS_URL || 'http://127.0.0.1:9235';
const widths = [320, 375, 768, 1024, 1440];
const pages = [
  'index.html',
  'about.html',
  'services.html',
  'work.html',
  'process.html',
  'contact.html',
  'payments.html',
  'assets/invoice_generator.html'
];

const failures = [];
const checks = [];
const assert = (condition, message) => {
  checks.push(message);
  if (!condition) failures.push(message);
};

if (typeof WebSocket === 'undefined') {
  throw new Error('These tests require Node 22 or newer for the built-in WebSocket client.');
}

const target = await fetch(`${devtoolsUrl}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' }).then((response) => {
  if (!response.ok) throw new Error(`Unable to create a browser target: HTTP ${response.status}`);
  return response.json();
});

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

let nextId = 1;
const pending = new Map();
const eventListeners = new Map();
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id) {
    const handler = pending.get(message.id);
    if (!handler) return;
    pending.delete(message.id);
    if (message.error) handler.reject(new Error(message.error.message));
    else handler.resolve(message.result);
    return;
  }
  (eventListeners.get(message.method) || []).forEach((listener) => listener(message.params));
});

const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = nextId++;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
});

const on = (method, listener) => {
  if (!eventListeners.has(method)) eventListeners.set(method, []);
  eventListeners.get(method).push(listener);
};

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Browser evaluation failed');
  return result.result.value;
};

const waitFor = async (expression, timeout = 15000) => {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await evaluate(expression)) return;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
};

let pageErrors = [];
let failedResponses = [];
let requestedUrls = [];
on('Runtime.exceptionThrown', ({ exceptionDetails }) => pageErrors.push(exceptionDetails.text || 'Uncaught browser exception'));
on('Network.responseReceived', ({ response }) => {
  if (response.status >= 400 && response.url.startsWith(baseUrl)) failedResponses.push(`${response.status} ${response.url}`);
});
on('Network.requestWillBeSent', ({ request }) => requestedUrls.push(request.url));

await Promise.all([
  send('Page.enable'),
  send('Runtime.enable'),
  send('Network.enable')
]);
await send('Network.setCacheDisabled', { cacheDisabled: true });

const navigate = async (path) => {
  pageErrors = [];
  failedResponses = [];
  requestedUrls = [];
  await send('Page.navigate', { url: `${baseUrl}/${path}` });
  await waitFor('document.readyState === "complete"');
  await sleep(180);
};

for (const width of widths) {
  await send('Emulation.setDeviceMetricsOverride', {
    width,
    height: 900,
    deviceScaleFactor: 1,
    mobile: width <= 768
  });

  for (const page of pages) {
    await navigate(page);
    const result = await evaluate(`(() => {
      const ids = [...document.querySelectorAll('[id]')].map((element) => element.id);
      const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
      return {
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        duplicateIds: [...new Set(duplicateIds)],
        nestedControls: document.querySelectorAll('a a, a button, button a, button button').length,
        hasMain: Boolean(document.querySelector('main'))
      };
    })()`);

    assert(!result.overflow, `${page} has no horizontal overflow at ${width}px`);
    assert(result.duplicateIds.length === 0, `${page} has no duplicate IDs at ${width}px`);
    assert(result.nestedControls === 0, `${page} has no nested interactive controls at ${width}px`);
    assert(result.hasMain, `${page} has a main landmark at ${width}px`);
    assert(pageErrors.length === 0, `${page} has no browser exceptions at ${width}px`);
    assert(failedResponses.length === 0, `${page} has no failed local asset responses at ${width}px`);

    if (page !== 'assets/invoice_generator.html' && width <= 768) {
      const menu = await evaluate(`(() => {
        const toggle = document.querySelector('.menu-toggle');
        toggle.click();
        const links = [...document.querySelectorAll('.mobile-nav a')];
        const result = {
          expanded: toggle.getAttribute('aria-expanded'),
          label: toggle.getAttribute('aria-label'),
          open: document.querySelector('.mobile-nav').classList.contains('open'),
          toggleHeight: toggle.getBoundingClientRect().height,
          minimumLinkHeight: Math.min(...links.map((link) => link.getBoundingClientRect().height))
        };
        toggle.click();
        return result;
      })()`);
      assert(menu.expanded === 'true' && menu.open, `${page} mobile navigation opens at ${width}px`);
      assert(menu.label === 'Close menu', `${page} mobile toggle announces its open state at ${width}px`);
      assert(menu.toggleHeight >= 44 && menu.minimumLinkHeight >= 44, `${page} mobile controls are at least 44px high at ${width}px`);
    }

    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    const focus = await evaluate(`(() => {
      const active = document.activeElement;
      const style = getComputedStyle(active);
      return { tag: active.tagName, outlineWidth: parseFloat(style.outlineWidth) || 0 };
    })()`);
    assert(focus.tag !== 'BODY' && focus.outlineWidth >= 2, `${page} exposes a visible keyboard focus outline at ${width}px`);
  }

  await navigate('work.html');
  await evaluate(`(async () => {
    const images = [...document.querySelectorAll('.featured-project-image, .project-card-image')];
    for (const image of images) {
      image.scrollIntoView({ block: 'center' });
      if (!image.complete) await new Promise((resolve) => image.addEventListener('load', resolve, { once: true }));
    }
    window.scrollTo(0, 0);
  })()`);
  const workLayout = await evaluate(`(() => {
    const grid = document.querySelector('.recent-projects-grid');
    const images = [...document.querySelectorAll('.featured-project-image, .project-card-image')];
    return {
      columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
      imagesReady: images.every((image) => image.complete && image.naturalWidth > 0),
      imageMetadata: images.every((image) => image.getAttribute('width') === '1440' && image.getAttribute('height') === '900' && getComputedStyle(image).objectFit === 'cover'),
      actionHeight: Math.min(...[...document.querySelectorAll('.case-actions a, .project-actions a')].map((link) => link.getBoundingClientRect().height))
    };
  })()`);
  const expectedColumns = width <= 375 ? 1 : width === 768 ? 2 : 3;
  assert(workLayout.columns === expectedColumns, `Work grid uses ${expectedColumns} column(s) at ${width}px`);
  assert(workLayout.imagesReady && workLayout.imageMetadata, `Work images load with 1440×900 metadata and object-fit cover at ${width}px`);
  assert(workLayout.actionHeight >= 44, `Work action links are at least 44px high at ${width}px`);
}

await send('Emulation.setScriptExecutionDisabled', { value: true });
await navigate('index.html');
const noScriptReveal = await evaluate(`(() => {
  const reveal = document.querySelector('.reveal');
  return !document.documentElement.classList.contains('js') && getComputedStyle(reveal).opacity === '1';
})()`);
assert(noScriptReveal, 'Reveal content remains visible when JavaScript is disabled');
await send('Emulation.setScriptExecutionDisabled', { value: false });

await send('Emulation.setEmulatedMedia', { media: 'screen', features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
await navigate('index.html');
const reducedMotion = await evaluate(`(() => {
  const style = getComputedStyle(document.querySelector('.reveal'));
  return style.opacity === '1' && style.transform === 'none' && parseFloat(style.transitionDuration) <= 0.001;
})()`);
assert(reducedMotion, 'Reduced-motion mode keeps reveal content visible without motion');
await send('Emulation.setEmulatedMedia', { media: 'screen', features: [] });

await navigate('index.html');
const homepage = await evaluate(`(() => ({
  text: document.body.innerText,
  projects: [...document.querySelectorAll('.work-grid .project h3')].map((heading) => heading.textContent.trim()),
  externalLinksValid: [...document.querySelectorAll('.work-grid a[href^="http"]')].every((link) => link.target === '_blank' && link.relList.contains('noopener') && link.relList.contains('noreferrer')),
  capabilityCount: document.querySelectorAll('.capabilities-grid article').length
}))()`);
assert(homepage.projects.join('|') === 'Generative A.I — Industrial Automation|SNA Cleaning Services|Sticky Notes Capstone', 'Homepage shows the three specified genuine projects');
assert(!/Northstar|Arch Studio|Field Notes Co\.|Sarah M\.|Daniel R\.|Mia K\.|Client notes/i.test(homepage.text), 'Homepage contains no fictional projects or testimonials');
assert(homepage.externalLinksValid, 'Homepage project links use new tabs with noopener and noreferrer');
assert(homepage.capabilityCount === 3, 'Homepage contains three objective capability items');

await navigate('work.html');
const workContent = await evaluate(`(() => {
  const featured = [...document.querySelectorAll('.case-study h2')].map((heading) => heading.textContent.trim());
  const recent = [...document.querySelectorAll('.recent-projects .recent-project-card h4')].map((heading) => heading.textContent.trim());
  const badges = [...document.querySelectorAll('.project-tags li')].map((badge) => badge.textContent.trim());
  return {
    featured,
    recent,
    badges,
    software: [...document.querySelectorAll('.software-automation .recent-project-card h3')].map((heading) => heading.textContent.trim()),
    wonderAlt: document.querySelector('img[src$="wondercubs-studio.webp"]').alt,
    text: document.body.innerText,
    externalLinksValid: [...document.querySelectorAll('a[href^="http"]')].every((link) => link.target === '_blank' && link.relList.contains('noopener') && link.relList.contains('noreferrer'))
  };
})()`);
assert(workContent.featured.join('|') === 'Generative A.I — Industrial Automation|Sticky Notes Capstone|WonderCubs Studio — In Development', 'Featured Work uses the specified order and status');
assert(workContent.recent.join('|') === 'SNA Cleaning Services|AJ Air Systems|Lee’s Nail It Salon|Ultimate Liquors|Cay Accessories|D’vine Funeral Home|Valentine’s Cards', 'Recent Projects uses the specified seven-project order');
assert(workContent.software.join('|') === 'Invoice Generator', 'Software & Automation contains only Invoice Generator');
assert(workContent.wonderAlt === 'WonderCubs Studio application architecture diagram', 'WonderCubs architecture image has accurate alt text');
assert(!/AI agents|working AI|InterSacks Office Automation|Excel Report Generator|PDF-to-Excel Extractor|Folder Auto Backup|Bulk File Renamer/i.test(workContent.text), 'Work page removes overstated AI and planned Python automation claims');
assert(!workContent.badges.some((badge) => /Website|Interactive Design|Funeral Services|E-commerce/i.test(badge)), 'Work technology badges contain no project-type or industry labels');
assert(workContent.externalLinksValid, 'All Work external links use new tabs with noopener and noreferrer');

await navigate('payments.html');
const payment = await evaluate(`(() => ({
  hasForm: Boolean(document.querySelector('form, input[name="invoiceNumber"], input[name="amount"]')),
  scripts: [...document.scripts].map((script) => script.src),
  text: document.body.innerText
}))()`);
assert(!payment.hasForm, 'Payment page accepts no invoice number or amount');
assert(!payment.scripts.some((source) => /payments\.js/i.test(source)), 'Payment integration JavaScript is not loaded');
assert(/Online payments\s+temporarily unavailable/i.test(payment.text), 'Payment page clearly states that online payments are unavailable');
assert(!requestedUrls.some((url) => /payfast|paypal|\/\.netlify\/functions\//i.test(url)), 'Payment page makes no provider or Netlify-function requests');

await navigate('assets/invoice_generator.html');
await waitFor('Boolean(window.invoiceGenerator)');
await waitFor('Boolean(window.jspdf && window.jspdf.jsPDF)', 30000);
const invoice = await evaluate(`(async () => {
  const api = window.invoiceGenerator;
  const form = document.querySelector('#invoice-form');
  const setValue = (selector, value, root = document) => {
    const input = root.querySelector(selector);
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return input;
  };
  const rows = () => [...document.querySelectorAll('.item-row')];
  const resetRows = () => {
    rows().slice(1).forEach((row) => row.remove());
    const row = rows()[0];
    setValue('.item-description', 'Consulting service', row);
    setValue('.item-quantity', '1', row);
    setValue('.item-rate', '1', row);
    api.calculateTotal();
    return row;
  };
  const completeDetails = () => {
    setValue('#company-name', 'InterSacks Test Company');
    setValue('#company-address', '1 Test Street, Paarl');
    setValue('#company-email', 'test@example.com');
    setValue('#company-phone', '0123456789');
    setValue('#client-name', 'Sample Client');
    setValue('#client-address', '2 Example Road, Paarl');
    setValue('#invoice-number', 'TEST-001');
    setValue('#invoice-date', '2026-08-19');
  };

  completeDetails();
  let reportValidityCalls = 0;
  const originalReportValidity = form.reportValidity.bind(form);
  form.reportValidity = () => { reportValidityCalls += 1; return originalReportValidity(); };

  let row = resetRows();
  setValue('.item-quantity', '2.5', row);
  setValue('.item-rate', '99.99', row);
  const decimalLine = {
    amountField: row.querySelector('.item-amount').value,
    totalCents: api.calculateTotal(),
    previewed: api.previewInvoice(),
    previewTotal: document.querySelector('.preview-total')?.textContent
  };
  const decimalData = api.collectInvoiceData();
  const decimalPdf = api.buildPdf(decimalData);
  const decimalPdfText = decimalPdf.internal.pages.flat(2).join(' ');
  decimalLine.pdfHasLine = decimalPdfText.includes('R249.98');
  decimalLine.pdfHasTotal = decimalPdfText.includes('TOTAL  R249.98');
  decimalLine.pdfBytes = decimalPdf.output('arraybuffer').byteLength;

  api.addItem({ description: 'Decimal service two', quantity: 1.25, rate: 10.01 });
  api.addItem({ description: 'Decimal service three', quantity: 3.5, rate: 0.10 });
  const multipleTotalCents = api.calculateTotal();
  const multiplePreview = api.previewInvoice();
  const multipleData = api.collectInvoiceData();
  const multiplePdf = api.buildPdf(multipleData);
  const multiplePdfText = multiplePdf.internal.pages.flat(2).join(' ');
  const multiplePreviewTotal = document.querySelector('.preview-total').textContent;

  const JsPdf = window.jspdf.jsPDF;
  const savedJsPdfLibrary = window.jspdf;
  let savedName = '';
  window.jspdf = {
    jsPDF: function InterceptedJsPdf(...args) {
      const doc = new JsPdf(...args);
      doc.save = (name) => { savedName = name; };
      return doc;
    }
  };
  const validDownload = api.downloadPdf();
  window.jspdf = savedJsPdfLibrary;

  let constructions = 0;
  let saves = 0;
  const originalLibrary = window.jspdf;
  window.jspdf = {
    jsPDF: function WrappedJsPdf(...args) {
      constructions += 1;
      const doc = new JsPdf(...args);
      doc.save = () => { saves += 1; };
      return doc;
    }
  };

  row = resetRows();
  setValue('.item-quantity', '0', row);
  const zeroQuantityValid = api.validateForm();
  const zeroQuantityDownload = api.downloadPdf();

  row = resetRows();
  setValue('.item-rate', '-1', row);
  const negativeRateValid = api.validateForm();
  const negativeRateDownload = api.downloadPdf();

  row = resetRows();
  setValue('.item-quantity', 'not-a-number', row);
  const nonNumericValid = api.validateForm();
  const nonNumericDownload = api.downloadPdf();

  row = resetRows();
  setValue('.item-rate', '0', row);
  const zeroTotalPreview = api.previewInvoice();
  const zeroTotalDownload = api.downloadPdf();
  window.jspdf = originalLibrary;

  row = resetRows();
  setValue('.item-description', '<img src=x onerror=alert(1)>', row);
  setValue('.item-rate', '1', row);
  const safePreview = api.previewInvoice();
  const unsafePreviewNodes = document.querySelector('#preview-document img, #preview-document script, #preview-document iframe');

  resetRows();
  rows()[0].remove();
  for (let index = 0; index < 45; index += 1) {
    api.addItem({
      description: 'Long consulting description for pagination testing '.repeat(6) + index,
      quantity: 1,
      rate: 1.01
    });
  }
  const longData = api.collectInvoiceData();
  const longPdf = api.buildPdf(longData);
  const pageCount = longPdf.getNumberOfPages();

  const savedLibrary = window.jspdf;
  delete window.jspdf;
  let missingLibraryMessage = '';
  try { api.buildPdf(longData); } catch (error) { missingLibraryMessage = error.message; }
  window.jspdf = savedLibrary;

  return {
    decimalLine,
    multipleTotalCents,
    multiplePreview,
    multiplePreviewTotal,
    multiplePdfHasTotal: multiplePdfText.includes('TOTAL  R262.84'),
    validDownload,
    savedName,
    reportValidityCalls,
    zeroQuantityValid,
    zeroQuantityDownload,
    negativeRateValid,
    negativeRateDownload,
    nonNumericValid,
    nonNumericDownload,
    rejectsInfinity: api.calculateLineCents(Infinity, 1) === null && api.calculateLineCents(1, Infinity) === null,
    zeroTotalPreview,
    zeroTotalDownload,
    invalidConstructions: constructions,
    invalidSaves: saves,
    safePreview,
    unsafePreviewNodes: Boolean(unsafePreviewNodes),
    pageCount,
    missingLibraryMessage
  };
})()`);

assert(invoice.decimalLine.amountField === 'R249.98', 'Invoice line displays 2.5 × 99.99 as R249.98');
assert(invoice.decimalLine.totalCents === 24998 && invoice.decimalLine.previewTotal === 'Total: R249.98', 'Invoice preview uses the same 24998-cent line total');
assert(invoice.decimalLine.pdfHasLine && invoice.decimalLine.pdfHasTotal && invoice.decimalLine.pdfBytes > 0, 'Invoice PDF uses R249.98 for the line and total');
assert(invoice.multipleTotalCents === 26284 && invoice.multiplePreview && invoice.multiplePreviewTotal === 'Total: R262.84' && invoice.multiplePdfHasTotal, 'Several decimal line items sum once in cents and match preview/PDF totals');
assert(invoice.validDownload && invoice.savedName === 'invoice-TEST-001.pdf', 'Valid invoice reaches the intercepted PDF save path');
assert(invoice.reportValidityCalls > 0, 'Preview and download call reportValidity');
assert(!invoice.zeroQuantityValid && !invoice.zeroQuantityDownload, 'Zero quantity is rejected');
assert(!invoice.negativeRateValid && !invoice.negativeRateDownload, 'Negative rate is rejected');
assert(!invoice.nonNumericValid && !invoice.nonNumericDownload && invoice.rejectsInfinity, 'Non-numeric and non-finite values are rejected');
assert(invoice.zeroTotalPreview && !invoice.zeroTotalDownload, 'A zero-total invoice may be previewed but cannot download');
assert(invoice.invalidConstructions === 0 && invoice.invalidSaves === 0, 'Invalid and zero-total invoices never construct or save a PDF');
assert(invoice.safePreview && !invoice.unsafePreviewNodes, 'HTML-like invoice input remains safely rendered as text');
assert(invoice.pageCount > 1, 'Long descriptions and 45 items create multiple PDF pages');
assert(/could not be loaded/i.test(invoice.missingLibraryMessage), 'Missing jsPDF produces the expected user-facing error');

await send('Page.close').catch(() => {});
socket.close();

console.log(JSON.stringify({ checks: checks.length, failures, invoice }, null, 2));
if (failures.length) process.exitCode = 1;
