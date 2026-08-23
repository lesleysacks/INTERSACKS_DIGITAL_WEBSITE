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
  'assets/invoice_generator.html',
  'assets/quote_generator.html',
  'assets/job_card_generator.html'
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

    if (!page.startsWith('assets/') && width <= 768) {
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

await send('Emulation.setEmulatedMedia', { media: 'screen', features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
await navigate('assets/quote_generator.html');
const quoteReducedMotion = await evaluate(`(() => {
  const style = getComputedStyle(document.querySelector('.button'));
  return getComputedStyle(document.documentElement).scrollBehavior === 'auto' && parseFloat(style.transitionDuration) <= 0.001;
})()`);
assert(quoteReducedMotion, 'Quote Generator respects reduced-motion preferences');
await send('Emulation.setEmulatedMedia', { media: 'screen', features: [] });

await send('Emulation.setEmulatedMedia', { media: 'screen', features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
await navigate('assets/job_card_generator.html');
const jobCardReducedMotion = await evaluate(`(() => {
  const style = getComputedStyle(document.querySelector('.button'));
  return getComputedStyle(document.documentElement).scrollBehavior === 'auto' && parseFloat(style.transitionDuration) <= 0.001;
})()`);
assert(jobCardReducedMotion, 'Job Card Generator respects reduced-motion preferences');
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
    jobCardLink: document.querySelector('a[href="assets/job_card_generator.html"]')?.textContent.trim(),
    jobCardImage: document.querySelector('img[src="assets/images/projects/job-card-generator.webp"]')?.getAttribute('alt'),
    wonderAlt: document.querySelector('img[src$="wondercubs-studio.webp"]').alt,
    text: document.body.innerText,
    externalLinksValid: [...document.querySelectorAll('a[href^="http"]')].every((link) => link.target === '_blank' && link.relList.contains('noopener') && link.relList.contains('noreferrer'))
  };
})()`);
assert(workContent.featured.join('|') === 'Generative A.I — Industrial Automation|Sticky Notes Capstone|WonderCubs Studio — In Development', 'Featured Work uses the specified order and status');
assert(workContent.recent.join('|') === 'SNA Cleaning Services|AJ Air Systems|Lee’s Nail It Salon|Ultimate Liquors|Cay Accessories|D’vine Funeral Home|Valentine’s Cards', 'Recent Projects uses the specified seven-project order');
assert(workContent.software.join('|') === 'Invoice Generator|Quote Generator|Job Card Generator', 'Software & Automation contains Invoice Generator, Quote Generator and Job Card Generator in order');
assert(workContent.jobCardLink === 'Open Live Tool ↗' && /Job Card Generator/.test(workContent.jobCardImage), 'Job Card Work card uses the correct local tool link and meaningful screenshot alt text');
assert(workContent.wonderAlt === 'WonderCubs Studio application architecture diagram', 'WonderCubs architecture image has accurate alt text');
assert(!/AI agents|working AI|InterSacks Office Automation|Excel Report Generator|PDF-to-Excel Extractor|Folder Auto Backup|Bulk File Renamer/i.test(workContent.text), 'Work page removes overstated AI and planned Python automation claims');
assert(!workContent.badges.some((badge) => /Website|Interactive Design|Funeral Services|E-commerce/i.test(badge)), 'Work technology badges contain no project-type or industry labels');
assert(workContent.externalLinksValid, 'All Work external links use new tabs with noopener and noreferrer');

await navigate('about.html');
await evaluate(`(async () => {
  const image = document.querySelector('.founder-photo img');
  image.scrollIntoView({ block: 'center' });
  if (!image.complete) {
    await new Promise((resolve) => {
      image.addEventListener('load', resolve, { once: true });
      image.addEventListener('error', resolve, { once: true });
    });
  }
  window.scrollTo(0, 0);
})()`);
const founderPortrait = await evaluate(`(() => {
  const image = document.querySelector('.founder-photo img');
  return Boolean(image && image.complete && image.naturalWidth > 0 && /Lesley Sacks/.test(image.alt));
})()`);
assert(founderPortrait, 'Founder portrait continues to load with meaningful alt text');

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

await navigate('assets/quote_generator.html');
await waitFor('Boolean(window.quoteGenerator)');
await waitFor('Boolean(window.jspdf && window.jspdf.jsPDF)', 30000);
const quote = await evaluate(`(async () => {
  const api = window.quoteGenerator;
  const form = document.querySelector('#quote-form');
  const setValue = (selector, value, root = document) => {
    const control = root.querySelector(selector);
    control.value = value;
    control.dispatchEvent(new Event('input', { bubbles: true }));
    control.dispatchEvent(new Event('change', { bubbles: true }));
    return control;
  };
  const setChecked = (selector, checked) => {
    const control = document.querySelector(selector);
    control.checked = checked;
    control.dispatchEvent(new Event('input', { bubbles: true }));
    control.dispatchEvent(new Event('change', { bubbles: true }));
    return control;
  };
  const rows = () => [...document.querySelectorAll('.item-row')];
  const resetRows = () => {
    rows().slice(1).forEach((row) => row.remove());
    const row = rows()[0] || api.addItem();
    setValue('.item-description', 'Consulting service', row);
    setValue('.item-quantity', '1', row);
    setValue('.item-rate', '1', row);
    api.calculateTotals();
    return row;
  };
  const setDiscount = (type, amount = '') => {
    setValue('#discount-type', type);
    if (type !== 'none') setValue('#discount-value', amount);
  };
  const completeDetails = () => {
    setValue('#business-name', 'InterSacks Test Studio');
    setValue('#business-email', 'studio@example.com');
    setValue('#business-phone', '021 000 0000');
    setValue('#business-address', '1 Sample Street, Paarl');
    setValue('#customer-name', 'Sample Customer');
    setValue('#customer-company', 'Example Trading');
    setValue('#customer-email', 'customer@example.com');
    setValue('#customer-phone', '082 000 0000');
    setValue('#customer-address', '2 Example Road, Cape Town');
    setValue('#quote-number', 'Q-2026-001');
    setValue('#issue-date', '2026-08-23');
    setValue('#valid-until', '2026-09-06');
    setValue('#quote-notes', 'Scope is based on the supplied project information.');
    setValue('#quote-terms', 'Timelines and payment milestones can be confirmed in writing.');
    setValue('#acceptance-instructions', 'Reply in writing to confirm acceptance.');
  };

  const initialState = {
    rowCount: rows().length,
    removeHidden: rows()[0].querySelector('.remove-button').hidden,
    taxEnabled: document.querySelector('#tax-enabled').checked,
    taxRateDisabled: document.querySelector('#tax-rate').disabled,
    discountType: document.querySelector('#discount-type').value,
    quoteNumber: document.querySelector('#quote-number').value,
    privacyNotice: document.body.innerText.includes('Your quote information stays in this browser session and is not uploaded by InterSacks Digital.'),
    taxNotice: document.body.innerText.includes('responsible for entering the correct tax information'),
    minimumTargetHeight: Math.min(...[...document.querySelectorAll('button, a, input:not([type="checkbox"]), select, textarea, .check-field label')]
      .filter((control) => control.getClientRects().length)
      .map((control) => control.getBoundingClientRect().height))
  };

  completeDetails();
  let reportValidityCalls = 0;
  const originalReportValidity = form.reportValidity.bind(form);
  form.reportValidity = () => { reportValidityCalls += 1; return originalReportValidity(); };

  let row = resetRows();
  setValue('.item-quantity', '2.5', row);
  setValue('.item-rate', '99.99', row);
  const decimalTotals = api.calculateTotals();
  const decimalPreview = api.previewQuote();
  const decimalData = api.collectQuoteData();
  const decimalPdf = api.buildPdf(decimalData);
  const decimalPdfText = decimalPdf.internal.pages.flat(2).join(' ');
  const decimalLine = {
    amountField: row.querySelector('.item-amount').value,
    subtotalCents: decimalTotals.subtotalCents,
    totalCents: decimalTotals.totalCents,
    previewed: decimalPreview,
    previewTotal: document.querySelector('.quote-total strong')?.textContent,
    previewFocused: document.activeElement.id === 'preview-title',
    pdfHasLine: decimalPdfText.includes('R249.98'),
    pdfHasTotal: decimalPdfText.includes('TOTAL  R249.98'),
    pdfHasDetails: decimalPdfText.includes('InterSacks Test Studio') && decimalPdfText.includes('Sample Customer') && decimalPdfText.includes('Q-2026-001'),
    pdfBytes: decimalPdf.output('arraybuffer').byteLength
  };

  api.addItem({ description: 'Decimal service two', quantity: 1.25, rate: 10.01 });
  api.addItem({ description: 'Decimal service three', quantity: 3.5, rate: 0.10 });
  const multipleTotals = api.calculateTotals();
  const multiplePreview = api.previewQuote();

  setDiscount('percentage', '10');
  setChecked('#tax-enabled', false);
  const percentageTotals = api.calculateTotals();
  const percentagePreview = api.previewQuote();
  const percentageData = api.collectQuoteData();
  const percentagePdf = api.buildPdf(percentageData);
  const percentagePdfText = percentagePdf.internal.pages.flat(2).join(' ');
  const percentageResult = {
    subtotalCents: percentageTotals.subtotalCents,
    discountCents: percentageTotals.discountCents,
    taxCents: percentageTotals.taxCents,
    totalCents: percentageTotals.totalCents,
    previewed: percentagePreview,
    previewTotal: document.querySelector('.quote-total strong')?.textContent,
    previewHasTax: Boolean(document.querySelector('.quote-tax')),
    pdfHasDiscount: percentagePdfText.includes('DISCOUNT  -R26.28'),
    pdfHasTotal: percentagePdfText.includes('TOTAL  R236.56')
  };

  setChecked('#tax-enabled', true);
  setValue('#tax-rate', '15');
  const taxedTotals = api.calculateTotals();
  const taxedPreview = api.previewQuote();
  const taxedData = api.collectQuoteData();
  const taxedPdf = api.buildPdf(taxedData);
  const taxedPdfText = taxedPdf.internal.pages.flat(2).join(' ');
  const taxedResult = {
    discountCents: taxedTotals.discountCents,
    taxCents: taxedTotals.taxCents,
    totalCents: taxedTotals.totalCents,
    previewed: taxedPreview,
    previewTax: document.querySelector('.quote-tax strong')?.textContent,
    previewTotal: document.querySelector('.quote-total strong')?.textContent,
    pdfHasTax: taxedPdfText.includes('TAX') && taxedPdfText.includes('R35.48'),
    pdfHasTotal: taxedPdfText.includes('TOTAL  R272.04')
  };

  setChecked('#tax-enabled', false);
  setDiscount('fixed', '12.34');
  const fixedTotals = api.calculateTotals();

  setDiscount('none');
  row = resetRows();
  setValue('.item-rate', '100', row);
  setValue('#quote-number', 'Q 2026/001');
  const JsPdf = window.jspdf.jsPDF;
  const savedJsPdfLibrary = window.jspdf;
  let savedName = '';
  window.jspdf = {
    jsPDF: function InterceptedQuoteJsPdf(...args) {
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
    jsPDF: function WrappedQuoteJsPdf(...args) {
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
  setValue('.item-description', '', row);
  const blankDescriptionValid = api.validateForm();
  const blankDescriptionDownload = api.downloadPdf();

  row = resetRows();
  setValue('.item-rate', '0', row);
  const zeroRateValid = api.validateForm();
  const zeroRateDownload = api.downloadPdf();

  row = resetRows();
  setValue('.item-rate', '-1', row);
  const negativeRateValid = api.validateForm();
  const negativeRateDownload = api.downloadPdf();

  row = resetRows();
  setValue('.item-quantity', 'not-a-number', row);
  const nonNumericValid = api.validateForm();
  const nonNumericDownload = api.downloadPdf();

  row = resetRows();
  setValue('#valid-until', '2026-08-22');
  const invalidDateValid = api.validateForm();
  const invalidDateDownload = api.downloadPdf();
  setValue('#valid-until', '2026-09-06');

  row = resetRows();
  setDiscount('fixed', '2');
  const excessiveDiscountValid = api.validateForm();
  const excessiveDiscountDownload = api.downloadPdf();

  setDiscount('percentage', '100');
  const zeroTotalPreview = api.previewQuote();
  const zeroTotalDownload = api.downloadPdf();
  window.jspdf = originalLibrary;

  row = resetRows();
  setDiscount('none');
  setValue('.item-description', '<img src=x onerror=alert(1)>', row);
  setValue('.item-rate', '1', row);
  const safePreview = api.previewQuote();
  const unsafePreviewNodes = document.querySelector('#preview-document img, #preview-document script, #preview-document iframe');
  const safePreviewText = document.querySelector('#preview-document').textContent.includes('<img src=x onerror=alert(1)>');

  const originalOpen = window.open;
  const openedUrls = [];
  window.open = (url) => {
    openedUrls.push(url);
    return { opener: window };
  };
  row = resetRows();
  setValue('.item-rate', '100', row);
  setValue('#quote-number', 'Q-2026-014');
  const sharedUrl = api.shareWhatsApp();
  const decodedSummary = decodeURIComponent(sharedUrl.split('text=')[1]);
  setValue('.item-quantity', '0', row);
  const openedBeforeInvalidShare = openedUrls.length;
  const invalidShare = api.shareWhatsApp();
  const invalidShareOpened = openedUrls.length > openedBeforeInvalidShare;
  window.open = originalOpen;

  resetRows();
  rows().forEach((itemRow) => itemRow.remove());
  setDiscount('none');
  setChecked('#tax-enabled', true);
  setValue('#tax-rate', '15');
  setValue('#quote-notes', 'Detailed quotation note for pagination testing. '.repeat(30));
  setValue('#quote-terms', 'Neutral quotation term for pagination testing. '.repeat(40));
  for (let index = 0; index < 45; index += 1) {
    api.addItem({
      description: 'Long quotation description for reliable multi-page PDF testing '.repeat(6) + index,
      quantity: 1,
      rate: 1.01
    });
  }
  const longData = api.collectQuoteData();
  const longPdf = api.buildPdf(longData);
  const pageCount = longPdf.getNumberOfPages();
  const longPdfText = longPdf.internal.pages.flat(2).join(' ');

  const savedLibrary = window.jspdf;
  delete window.jspdf;
  const missingLibraryDownload = api.downloadPdf();
  const missingLibraryUiMessage = document.querySelector('#form-message').textContent;
  let missingLibraryMessage = '';
  try { api.buildPdf(longData); } catch (error) { missingLibraryMessage = error.message; }
  window.jspdf = savedLibrary;

  setValue('#business-name', 'Keep this value');
  const originalConfirm = window.confirm;
  window.confirm = () => false;
  const cancelledReset = api.resetQuote();
  const cancelledResetPreserved = document.querySelector('#business-name').value === 'Keep this value';
  window.confirm = () => true;
  const confirmedReset = api.resetQuote();
  const resetState = {
    rowCount: rows().length,
    description: rows()[0].querySelector('.item-description').value,
    taxEnabled: document.querySelector('#tax-enabled').checked,
    taxRateDisabled: document.querySelector('#tax-rate').disabled,
    discountType: document.querySelector('#discount-type').value,
    previewHidden: document.querySelector('#preview-document').hidden,
    businessName: document.querySelector('#business-name').value,
    focused: document.activeElement.id,
    hasIssueDate: Boolean(document.querySelector('#issue-date').value),
    hasValidUntil: Boolean(document.querySelector('#valid-until').value)
  };
  window.confirm = originalConfirm;

  return {
    initialState,
    decimalLine,
    multipleTotals,
    multiplePreview,
    percentageResult,
    taxedResult,
    fixedTotals,
    validDownload,
    savedName,
    reportValidityCalls,
    zeroQuantityValid,
    zeroQuantityDownload,
    blankDescriptionValid,
    blankDescriptionDownload,
    zeroRateValid,
    zeroRateDownload,
    negativeRateValid,
    negativeRateDownload,
    nonNumericValid,
    nonNumericDownload,
    rejectsInfinity: api.calculateLineCents(Infinity, 1) === null && api.calculateLineCents(1, Infinity) === null,
    invalidDateValid,
    invalidDateDownload,
    excessiveDiscountValid,
    excessiveDiscountDownload,
    zeroTotalPreview,
    zeroTotalDownload,
    invalidConstructions: constructions,
    invalidSaves: saves,
    safePreview,
    safePreviewText,
    unsafePreviewNodes: Boolean(unsafePreviewNodes),
    sharedUrl,
    openedUrl: openedUrls[0],
    decodedSummary,
    invalidShare,
    invalidShareOpened,
    pageCount,
    repeatedHeadings: (longPdfText.match(/DESCRIPTION/g) || []).length,
    hasPageNumbers: longPdfText.includes('Page 1 of'),
    missingLibraryDownload,
    missingLibraryUiMessage,
    missingLibraryMessage,
    cancelledReset,
    cancelledResetPreserved,
    confirmedReset,
    resetState
  };
})()`);

assert(quote.initialState.rowCount === 1 && quote.initialState.removeHidden && !quote.initialState.taxEnabled && quote.initialState.taxRateDisabled && quote.initialState.discountType === 'none' && /^Q-\d{4}-001$/.test(quote.initialState.quoteNumber), 'Quote Generator starts with one retained item, an editable generated number, no discount and tax disabled');
assert(quote.initialState.privacyNotice && quote.initialState.taxNotice, 'Quote Generator displays the browser-session privacy notice and responsible-tax guidance');
assert(quote.initialState.minimumTargetHeight >= 44, 'Quote Generator interactive targets are at least 44px high');
assert(quote.decimalLine.amountField === 'R249.98' && quote.decimalLine.subtotalCents === 24998 && quote.decimalLine.totalCents === 24998, 'Quote line displays and calculates 2.5 × 99.99 as R249.98');
assert(quote.decimalLine.previewed && quote.decimalLine.previewTotal === 'R249.98' && quote.decimalLine.pdfHasLine && quote.decimalLine.pdfHasTotal && quote.decimalLine.pdfBytes > 0, 'Quote form, preview and PDF agree on the R249.98 decimal total');
assert(quote.decimalLine.previewFocused, 'Successful Quote preview moves focus to the preview heading');
assert(quote.decimalLine.pdfHasDetails, 'Quote PDF contains business, customer and quote information');
assert(quote.multipleTotals.subtotalCents === 26284 && quote.multipleTotals.totalCents === 26284 && quote.multiplePreview, 'Several decimal quote items sum once in cents to R262.84');
assert(quote.percentageResult.subtotalCents === 26284 && quote.percentageResult.discountCents === 2628 && quote.percentageResult.taxCents === 0 && quote.percentageResult.totalCents === 23656, 'Ten-percent discount is cent-accurate with tax disabled');
assert(quote.percentageResult.previewed && quote.percentageResult.previewTotal === 'R236.56' && !quote.percentageResult.previewHasTax && quote.percentageResult.pdfHasDiscount && quote.percentageResult.pdfHasTotal, 'Percentage-discount form, preview and PDF totals match exactly');
assert(quote.taxedResult.discountCents === 2628 && quote.taxedResult.taxCents === 3548 && quote.taxedResult.totalCents === 27204, 'Optional 15% tax is calculated in cents on the discounted subtotal');
assert(quote.taxedResult.previewed && quote.taxedResult.previewTax === 'R35.48' && quote.taxedResult.previewTotal === 'R272.04' && quote.taxedResult.pdfHasTax && quote.taxedResult.pdfHasTotal, 'Tax-enabled form, preview and PDF totals match exactly');
assert(quote.fixedTotals.discountCents === 1234 && quote.fixedTotals.totalCents === 25050, 'Fixed R12.34 discount remains cent-accurate');
assert(quote.validDownload && quote.savedName === 'quote-Q-2026-001.pdf', 'Valid Quote download uses a sanitized PDF filename');
assert(quote.reportValidityCalls > 0, 'Quote preview, download and share actions call reportValidity');
assert(!quote.zeroQuantityValid && !quote.zeroQuantityDownload, 'Quote Generator rejects zero quantity and blocks its PDF');
assert(!quote.blankDescriptionValid && !quote.blankDescriptionDownload, 'Quote Generator rejects blank line-item descriptions and blocks their PDF');
assert(!quote.zeroRateValid && !quote.zeroRateDownload, 'Quote Generator rejects zero rates and blocks their PDF');
assert(!quote.negativeRateValid && !quote.negativeRateDownload, 'Quote Generator rejects negative rates and blocks their PDF');
assert(!quote.nonNumericValid && !quote.nonNumericDownload && quote.rejectsInfinity, 'Quote Generator rejects non-numeric and non-finite values');
assert(!quote.invalidDateValid && !quote.invalidDateDownload, 'Quote Generator rejects a valid-until date before the issue date');
assert(!quote.excessiveDiscountValid && !quote.excessiveDiscountDownload, 'Quote Generator rejects a fixed discount exceeding the subtotal');
assert(quote.zeroTotalPreview && !quote.zeroTotalDownload, 'A zero-total Quote may be previewed but cannot generate a PDF');
assert(quote.invalidConstructions === 0 && quote.invalidSaves === 0, 'Invalid and zero-total Quotes construct and save zero PDFs');
assert(quote.safePreview && quote.safePreviewText && !quote.unsafePreviewNodes, 'HTML-like Quote input remains harmless visible text in preview');
assert(/^https:\/\/wa\.me\/\?text=/.test(quote.sharedUrl) && quote.openedUrl === quote.sharedUrl && /Quotation Q-2026-014/.test(quote.decodedSummary) && /Prepared for: Sample Customer/.test(quote.decodedSummary) && /Valid until:/.test(quote.decodedSummary) && /Final total: R100\.00/.test(quote.decodedSummary) && /available separately/.test(quote.decodedSummary) && !/attached automatically/i.test(quote.decodedSummary), 'WhatsApp sharing opens an encoded minimal summary without claiming a PDF attachment');
assert(!quote.invalidShare && !quote.invalidShareOpened, 'Invalid Quotes cannot open WhatsApp sharing');
assert(quote.pageCount > 1 && quote.repeatedHeadings > 1 && quote.hasPageNumbers, 'Forty-five long Quote items produce a numbered multi-page PDF with repeated table headings');
assert(!quote.missingLibraryDownload && /could not be loaded/i.test(quote.missingLibraryUiMessage) && /could not be loaded/i.test(quote.missingLibraryMessage), 'Missing jsPDF is handled with a clear Quote Generator message and no PDF');
assert(!quote.cancelledReset && quote.cancelledResetPreserved && quote.confirmedReset, 'Quote reset requires confirmation and preserves data when cancelled');
assert(quote.resetState.rowCount === 1 && quote.resetState.description === '' && !quote.resetState.taxEnabled && quote.resetState.taxRateDisabled && quote.resetState.discountType === 'none' && quote.resetState.previewHidden && quote.resetState.businessName === '' && quote.resetState.focused === 'business-name' && quote.resetState.hasIssueDate && quote.resetState.hasValidUntil, 'Confirmed Quote reset restores one blank item, defaults, empty preview and first-field focus');

await navigate('assets/job_card_generator.html');
await waitFor('Boolean(window.jobCardGenerator)');
await waitFor('Boolean(window.jspdf && window.jspdf.jsPDF)', 30000);
const jobCard = await evaluate(`(async () => {
  const api = window.jobCardGenerator;
  const form = document.querySelector('#job-card-form');
  const setValue = (selector, value, root = document) => {
    const control = root.querySelector(selector);
    control.value = value;
    control.dispatchEvent(new Event('input', { bubbles: true }));
    control.dispatchEvent(new Event('change', { bubbles: true }));
    return control;
  };
  const setChecked = (selector, checked) => {
    const control = document.querySelector(selector);
    control.checked = checked;
    control.dispatchEvent(new Event('input', { bubbles: true }));
    control.dispatchEvent(new Event('change', { bubbles: true }));
    return control;
  };
  const rows = () => [...document.querySelectorAll('.material-row')];
  const resetRows = () => {
    rows().slice(1).forEach((row) => row.remove());
    const row = rows()[0] || api.addMaterial();
    setValue('.material-description', 'Replacement filter', row);
    setValue('.material-quantity', '1', row);
    setValue('.material-reference', 'RF-100', row);
    setValue('.material-notes', 'Installed during service', row);
    return row;
  };
  const completeDetails = () => {
    setValue('#business-name', 'InterSacks Test Service');
    setValue('#technician-name', 'Jordan Daniels');
    setValue('#business-phone', '021 000 0000');
    setValue('#business-email', 'service@example.com');
    setValue('#business-address', '1 Sample Street, Paarl');
    setValue('#customer-name', 'Sample Customer');
    setValue('#contact-person', 'Sam Jacobs');
    setValue('#customer-phone', '082 000 0000');
    setValue('#customer-email', 'customer@example.com');
    setValue('#service-address', '2 Example Road, Paarl');
    setValue('#job-card-number', 'JC-2026-001');
    setValue('#job-status', 'In Progress');
    setValue('#job-priority', 'Normal');
    setValue('#date-opened', '2026-08-23');
    setValue('#scheduled-date', '2026-08-24');
    setValue('#completion-date', '2026-08-24');
    setValue('#arrival-time', '08:15');
    setValue('#departure-time', '10:45');
    setValue('#equipment-type', 'Office air-conditioning unit');
    setValue('#equipment-make', 'CoolAir');
    setValue('#equipment-model', 'CX-240');
    setValue('#serial-number', 'SAFE-001');
    setValue('#equipment-location', 'Reception office');
    setValue('#reported-problem', 'Unit runs but does not cool the reception area.');
    setValue('#inspection-findings', 'A blocked filter and loose thermostat connection were identified.');
    setValue('#work-performed', 'Cleaned the filter, secured the connection and tested the cooling cycle.');
    setValue('#recommendations', 'Inspect and clean the filter every three months.');
    setChecked('#area-clean', true);
    setChecked('#equipment-tested', true);
    setChecked('#customer-informed', true);
    setChecked('#follow-up-required', false);
    setValue('#acknowledgement-name', 'Sam Jacobs');
    setValue('#acknowledgement-date', '2026-08-24');
    setChecked('#work-explained', true);
    resetRows();
  };

  const initialState = {
    rowCount: rows().length,
    removeHidden: rows()[0].querySelector('.remove-button').hidden,
    number: document.querySelector('#job-card-number').value,
    status: document.querySelector('#job-status').value,
    priority: document.querySelector('#job-priority').value,
    duration: document.querySelector('#service-duration').value,
    privacyNotice: document.body.innerText.includes('Your job card information stays in this browser session and is not uploaded by InterSacks Digital.'),
    acknowledgementNotice: document.body.innerText.includes('not presented as a legally verified digital signature'),
    hasBillingLanguage: /invoice|quotation|price|total|tax|payment|deposit/i.test(document.body.innerText),
    minimumTargetHeight: Math.min(...[...document.querySelectorAll('button, a, input:not([type="checkbox"]), select, textarea, .check-field label')]
      .filter((control) => control.getClientRects().length)
      .map((control) => control.getBoundingClientRect().height))
  };

  document.querySelector('#add-material-button').click();
  const addedRowCount = rows().length;
  const secondRemoveVisible = !rows()[1].querySelector('.remove-button').hidden;
  rows()[1].querySelector('.remove-button').click();
  const removedRowCount = rows().length;
  const retainedRemoveHidden = rows()[0].querySelector('.remove-button').hidden;

  completeDetails();
  const calculatedDuration = document.querySelector('#service-duration').value;
  let reportValidityCalls = 0;
  const originalReportValidity = form.reportValidity.bind(form);
  form.reportValidity = () => { reportValidityCalls += 1; return originalReportValidity(); };

  setValue('#job-status', 'Completed');
  setValue('#work-performed', '');
  const completedWithoutWorkValid = api.validateForm();
  const completedWithoutWorkFocused = document.activeElement.id;
  setValue('#work-performed', 'Completed the requested service and tested the unit.');
  setValue('#acknowledgement-name', '');
  const completedWithoutAcknowledgementValid = api.validateForm();
  setValue('#acknowledgement-name', 'Sam Jacobs');
  setValue('#acknowledgement-date', '');
  const completedWithoutAcknowledgementDateValid = api.validateForm();
  setValue('#acknowledgement-date', '2026-08-24');
  setChecked('#work-explained', false);
  const completedWithoutExplanationValid = api.validateForm();
  setChecked('#work-explained', true);
  const completedValid = api.validateForm();

  setValue('#job-status', 'In Progress');
  setChecked('#follow-up-required', true);
  const followUpShown = !document.querySelector('#follow-up-field').hidden && !document.querySelector('#follow-up-details').disabled && document.querySelector('#follow-up-details').required;
  setValue('#follow-up-details', '');
  const followUpWithoutDetailsValid = api.validateForm();
  setValue('#follow-up-details', 'Return after the replacement controller arrives.');
  const followUpWithDetailsValid = api.validateForm();
  setChecked('#follow-up-required', false);

  setValue('#completion-date', '2026-08-22');
  const invalidDateValid = api.validateForm();
  setValue('#completion-date', '2026-08-24');
  setValue('#arrival-time', '10:45');
  setValue('#departure-time', '08:15');
  const invalidTimeValid = api.validateForm();
  setValue('#arrival-time', '08:15');
  setValue('#departure-time', '10:45');

  const JsPdf = window.jspdf.jsPDF;
  const originalLibrary = window.jspdf;
  let invalidConstructions = 0;
  let invalidSaves = 0;
  window.jspdf = {
    jsPDF: function WrappedJobCardJsPdf(...args) {
      invalidConstructions += 1;
      const doc = new JsPdf(...args);
      doc.save = () => { invalidSaves += 1; };
      return doc;
    }
  };
  let row = resetRows();
  setValue('.material-quantity', '0', row);
  const zeroQuantityValid = api.validateForm();
  const zeroQuantityDownload = api.downloadPdf();
  row = resetRows();
  setValue('.material-quantity', '-1', row);
  const negativeQuantityValid = api.validateForm();
  const negativeQuantityDownload = api.downloadPdf();
  row = resetRows();
  setValue('.material-quantity', 'not-a-number', row);
  const nonNumericQuantityValid = api.validateForm();
  const nonNumericQuantityDownload = api.downloadPdf();
  row = resetRows();
  setValue('.material-quantity', '1000001', row);
  const excessiveQuantityValid = api.validateForm();
  const excessiveQuantityDownload = api.downloadPdf();
  row = resetRows();
  setValue('.material-description', '', row);
  const blankMaterialValid = api.validateForm();
  const blankMaterialDownload = api.downloadPdf();
  window.jspdf = originalLibrary;

  completeDetails();
  setValue('#internal-notes', 'PRIVATE INTERNAL SERVICE NOTE');
  setChecked('#include-internal-notes', false);
  const defaultPreviewed = api.previewJobCard();
  const defaultData = api.collectJobData();
  const defaultPdf = api.buildPdf(defaultData);
  const defaultPdfText = defaultPdf.internal.pages.flat(2).join(' ');
  const defaultPreviewText = document.querySelector('#preview-document').textContent;
  setChecked('#include-internal-notes', true);
  const enabledPreviewed = api.previewJobCard();
  const enabledData = api.collectJobData();
  const enabledPdf = api.buildPdf(enabledData);
  const enabledPdfText = enabledPdf.internal.pages.flat(2).join(' ');
  const enabledPreviewText = document.querySelector('#preview-document').textContent;

  setValue('#reported-problem', '<img src=x onerror=alert(1)>');
  setValue('.material-description', '<script>alert(1)<\\/script>', rows()[0]);
  const safePreview = api.previewJobCard();
  const safePreviewText = document.querySelector('#preview-document').textContent;
  const unsafePreviewNodes = document.querySelector('#preview-document img, #preview-document script, #preview-document iframe');

  setValue('#reported-problem', 'Unit runs but does not cool the reception area.');
  setValue('.material-description', 'Replacement filter', rows()[0]);
  setChecked('#include-internal-notes', false);
  const matchingPreview = api.previewJobCard();
  const matchingData = api.collectJobData();
  const matchingPdf = api.buildPdf(matchingData);
  const matchingPdfText = matchingPdf.internal.pages.flat(2).join(' ');
  const matchingPreviewText = document.querySelector('#preview-document').textContent;

  setValue('#job-card-number', 'JC 2026/001');
  let savedName = '';
  window.jspdf = {
    jsPDF: function InterceptedJobCardJsPdf(...args) {
      const doc = new JsPdf(...args);
      doc.save = (name) => { savedName = name; };
      return doc;
    }
  };
  const validDownload = api.downloadPdf();
  window.jspdf = originalLibrary;

  completeDetails();
  rows().forEach((materialRow) => materialRow.remove());
  setValue('#inspection-findings', 'Detailed inspection findings for pagination testing. '.repeat(35));
  setValue('#recommendations', 'Detailed recommendation for pagination testing. '.repeat(35));
  for (let index = 0; index < 45; index += 1) {
    api.addMaterial({
      description: 'Long material description for reliable multi-page PDF testing '.repeat(6) + index,
      quantity: 1,
      reference: 'PART-' + index,
      notes: 'Fitted and checked during the service visit.'
    });
  }
  const longData = api.collectJobData();
  const longPdf = api.buildPdf(longData);
  const pageCount = longPdf.getNumberOfPages();
  const longPdfText = longPdf.internal.pages.flat(2).join(' ');

  const savedLibrary = window.jspdf;
  delete window.jspdf;
  const missingLibraryDownload = api.downloadPdf();
  const missingLibraryUiMessage = document.querySelector('#form-message').textContent;
  let missingLibraryMessage = '';
  try { api.buildPdf(longData); } catch (error) { missingLibraryMessage = error.message; }
  window.jspdf = savedLibrary;

  setValue('#business-name', 'Keep this value');
  const originalConfirm = window.confirm;
  window.confirm = () => false;
  const cancelledReset = api.resetJobCard();
  const cancelledResetPreserved = document.querySelector('#business-name').value === 'Keep this value';
  window.confirm = () => true;
  const confirmedReset = api.resetJobCard();
  const resetState = {
    rowCount: rows().length,
    description: rows()[0].querySelector('.material-description').value,
    status: document.querySelector('#job-status').value,
    priority: document.querySelector('#job-priority').value,
    followUp: document.querySelector('#follow-up-required').checked,
    followUpHidden: document.querySelector('#follow-up-field').hidden,
    includeInternalNotes: document.querySelector('#include-internal-notes').checked,
    previewHidden: document.querySelector('#preview-document').hidden,
    businessName: document.querySelector('#business-name').value,
    focused: document.activeElement.id,
    hasOpenedDate: Boolean(document.querySelector('#date-opened').value),
    number: document.querySelector('#job-card-number').value
  };
  window.confirm = originalConfirm;

  return {
    initialState,
    addedRowCount,
    secondRemoveVisible,
    removedRowCount,
    retainedRemoveHidden,
    calculatedDuration,
    reportValidityCalls,
    completedWithoutWorkValid,
    completedWithoutWorkFocused,
    completedWithoutAcknowledgementValid,
    completedWithoutAcknowledgementDateValid,
    completedWithoutExplanationValid,
    completedValid,
    followUpShown,
    followUpWithoutDetailsValid,
    followUpWithDetailsValid,
    invalidDateValid,
    invalidTimeValid,
    zeroQuantityValid,
    zeroQuantityDownload,
    negativeQuantityValid,
    negativeQuantityDownload,
    nonNumericQuantityValid,
    nonNumericQuantityDownload,
    excessiveQuantityValid,
    excessiveQuantityDownload,
    blankMaterialValid,
    blankMaterialDownload,
    rejectsInfinity: api.parseMaterialQuantity(Infinity) === null && api.parseMaterialQuantity(-Infinity) === null,
    invalidConstructions,
    invalidSaves,
    defaultPreviewed,
    defaultPreviewHasInternal: defaultPreviewText.includes('PRIVATE INTERNAL SERVICE NOTE'),
    defaultPdfHasInternal: defaultPdfText.includes('PRIVATE INTERNAL SERVICE NOTE'),
    enabledPreviewed,
    enabledPreviewHasInternal: enabledPreviewText.includes('PRIVATE INTERNAL SERVICE NOTE'),
    enabledPdfHasInternal: enabledPdfText.includes('PRIVATE INTERNAL SERVICE NOTE'),
    safePreview,
    safePreviewText,
    unsafePreviewNodes: Boolean(unsafePreviewNodes),
    matchingPreview,
    matchingPreviewHasDetails: matchingPreviewText.includes('JC-2026-001') && matchingPreviewText.includes('In Progress') && matchingPreviewText.includes('Unit runs but does not cool the reception area.') && matchingPreviewText.includes('2 hours 30 minutes') && matchingPreviewText.includes('Replacement filter'),
    matchingPdfHasDetails: matchingPdfText.includes('JC-2026-001') && matchingPdfText.includes('STATUS IN PROGRESS') && matchingPdfText.includes('Unit runs but does not cool the reception area.') && matchingPdfText.includes('2 hours 30 minutes') && matchingPdfText.includes('Replacement filter'),
    matchingPdfBytes: matchingPdf.output('arraybuffer').byteLength,
    validDownload,
    savedName,
    pageCount,
    repeatedHeadings: (longPdfText.match(/DESCRIPTION/g) || []).length,
    hasPageNumbers: longPdfText.includes('Page 1 of'),
    missingLibraryDownload,
    missingLibraryUiMessage,
    missingLibraryMessage,
    cancelledReset,
    cancelledResetPreserved,
    confirmedReset,
    resetState
  };
})()`);

assert(jobCard.initialState.rowCount === 1 && jobCard.initialState.removeHidden && /^JC-\d{4}-001$/.test(jobCard.initialState.number) && jobCard.initialState.status === 'Open' && jobCard.initialState.priority === 'Normal' && jobCard.initialState.duration === 'Not calculated', 'Job Card Generator starts with one retained material row, generated editable number and service defaults');
assert(jobCard.initialState.privacyNotice && jobCard.initialState.acknowledgementNotice && !jobCard.initialState.hasBillingLanguage, 'Job Card Generator states session-only privacy and acknowledgement limits without billing language');
assert(jobCard.initialState.minimumTargetHeight >= 44, 'Job Card Generator interactive targets are at least 44px high');
assert(jobCard.addedRowCount === 2 && jobCard.secondRemoveVisible && jobCard.removedRowCount === 1 && jobCard.retainedRemoveHidden, 'Job Card Generator adds and removes material rows while retaining one blank-capable row');
assert(jobCard.calculatedDuration === '2 hours 30 minutes', 'Job Card Generator calculates 08:15 to 10:45 as 2 hours 30 minutes');
assert(!jobCard.completedWithoutWorkValid && jobCard.completedWithoutWorkFocused === 'work-performed' && jobCard.completedValid, 'Completed Job Cards require work-performed details and focus the missing field');
assert(!jobCard.completedWithoutAcknowledgementValid && !jobCard.completedWithoutAcknowledgementDateValid && !jobCard.completedWithoutExplanationValid, 'Completed Job Cards require the representative name, acknowledgement date and explanation confirmation');
assert(jobCard.followUpShown && !jobCard.followUpWithoutDetailsValid && jobCard.followUpWithDetailsValid, 'Follow-up selection reveals and requires an explanation');
assert(!jobCard.invalidDateValid && !jobCard.invalidTimeValid, 'Job Card Generator rejects completion dates and departure times earlier than their starting values');
assert(!jobCard.zeroQuantityValid && !jobCard.zeroQuantityDownload && !jobCard.negativeQuantityValid && !jobCard.negativeQuantityDownload && !jobCard.nonNumericQuantityValid && !jobCard.nonNumericQuantityDownload && !jobCard.excessiveQuantityValid && !jobCard.excessiveQuantityDownload && jobCard.rejectsInfinity, 'Job Card Generator rejects zero, negative, non-numeric, non-finite and excessive material quantities');
assert(!jobCard.blankMaterialValid && !jobCard.blankMaterialDownload, 'Job Card Generator rejects an active material row without a description');
assert(jobCard.invalidConstructions === 0 && jobCard.invalidSaves === 0, 'Invalid Job Cards construct and save zero PDFs');
assert(jobCard.reportValidityCalls > 0, 'Job Card preview, validation and download actions call reportValidity');
assert(jobCard.defaultPreviewed && !jobCard.defaultPreviewHasInternal && !jobCard.defaultPdfHasInternal, 'Internal Job Card notes are excluded from the preview and PDF by default');
assert(jobCard.enabledPreviewed && jobCard.enabledPreviewHasInternal && jobCard.enabledPdfHasInternal, 'Internal Job Card notes appear in the preview and PDF only when explicitly enabled');
assert(jobCard.safePreview && jobCard.safePreviewText.includes('<img src=x onerror=alert(1)>') && jobCard.safePreviewText.includes('<script>alert(1)</script>') && !jobCard.unsafePreviewNodes, 'HTML-like Job Card input remains harmless visible text in preview');
assert(jobCard.matchingPreview && jobCard.matchingPreviewHasDetails && jobCard.matchingPdfHasDetails && jobCard.matchingPdfBytes > 0, 'Job Card form, preview and PDF contain matching job, service-duration and material details');
assert(jobCard.validDownload && jobCard.savedName === 'job-card-JC-2026-001.pdf', 'Valid Job Card download uses a sanitized PDF filename');
assert(jobCard.pageCount > 1 && jobCard.repeatedHeadings > 1 && jobCard.hasPageNumbers, 'Forty-five long material rows produce a numbered multi-page Job Card PDF with repeated headings');
assert(!jobCard.missingLibraryDownload && /could not be loaded/i.test(jobCard.missingLibraryUiMessage) && /could not be loaded/i.test(jobCard.missingLibraryMessage), 'Missing jsPDF is handled with a clear Job Card message and no uncaught exception');
assert(!jobCard.cancelledReset && jobCard.cancelledResetPreserved && jobCard.confirmedReset, 'Job Card reset requires confirmation and preserves data when cancelled');
assert(jobCard.resetState.rowCount === 1 && jobCard.resetState.description === '' && jobCard.resetState.status === 'Open' && jobCard.resetState.priority === 'Normal' && !jobCard.resetState.followUp && jobCard.resetState.followUpHidden && !jobCard.resetState.includeInternalNotes && jobCard.resetState.previewHidden && jobCard.resetState.businessName === '' && jobCard.resetState.focused === 'business-name' && jobCard.resetState.hasOpenedDate && /^JC-\d{4}-001$/.test(jobCard.resetState.number), 'Confirmed Job Card reset restores one blank material row, defaults, empty preview and first-field focus');

await send('Page.close').catch(() => {});
socket.close();

console.log(JSON.stringify({ checks: checks.length, failures, invoice, quote, jobCard }, null, 2));
if (failures.length) process.exitCode = 1;
