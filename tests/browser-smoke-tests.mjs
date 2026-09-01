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
  'resources.html',
  'assets/invoice_generator.html',
  'assets/quote_generator.html',
  'assets/job_card_generator.html',
  'assets/whatsapp_order_builder.html',
  'assets/templates/greeting-cards/birthday-card-template.html',
  'assets/templates/greeting-cards/valentine-card-template.html'
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

  await navigate('services.html');
  const brandingProof = await evaluate(`(() => {
    const article = document.querySelector('.branding-service');
    const ctas = [...document.querySelectorAll('.service-proof-cta')];
    const cta = ctas[0];
    const style = cta ? getComputedStyle(cta) : null;
    const rect = cta ? cta.getBoundingClientRect() : null;
    return {
      count: ctas.length,
      insideBranding: Boolean(article && cta && article.contains(cta)),
      href: cta ? cta.getAttribute('href') : '',
      target: cta ? cta.getAttribute('target') : '',
      rel: cta ? cta.getAttribute('rel').split(' ').filter(Boolean) : [],
      accessibleName: cta ? cta.getAttribute('aria-label') : '',
      visible: Boolean(rect && rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'),
      height: rect ? rect.height : 0,
      noOverflow: document.documentElement.scrollWidth === document.documentElement.clientWidth,
      outsideBranding: document.querySelectorAll('.service-detail > article:not(.branding-service) .service-proof-cta').length
    };
  })()`);
  assert(brandingProof.count === 1, `Services page exposes exactly one Branding proof CTA at ${width}px`);
  assert(brandingProof.insideBranding, `Branding proof CTA is inside the Branding service at ${width}px`);
  assert(brandingProof.href === 'https://lesleysacks.github.io/INTERSACKS_APPAREL_WEBSITE/', `Branding proof CTA uses the exact Apparel URL at ${width}px`);
  assert(brandingProof.target === '_blank', `Branding proof CTA opens in a new tab at ${width}px`);
  assert(brandingProof.rel.includes('noopener') && brandingProof.rel.includes('noreferrer'), `Branding proof CTA protects the external tab at ${width}px`);
  assert(brandingProof.accessibleName === 'See InterSacks Apparel branding in action (opens in a new tab)', `Branding proof CTA has the exact accessible name at ${width}px`);
  assert(brandingProof.visible, `Branding proof CTA is visible at ${width}px`);
  assert(brandingProof.height >= 44, `Branding proof CTA is at least 44px high at ${width}px (measured ${brandingProof.height}px)`);
  assert(brandingProof.noOverflow, `Branding proof CTA causes no viewport overflow at ${width}px`);
  assert(brandingProof.outsideBranding === 0, `No other service contains the Branding proof CTA at ${width}px`);

  await navigate('work.html');
  await evaluate(`(async () => {
    if (document.fonts) await document.fonts.ready;
    const images = [...document.querySelectorAll('.featured-project-image, .project-card-image')];
    for (const image of images) {
      await new Promise((resolve, reject) => {
        const src = image.currentSrc || image.src;
        let timeout;
        const cleanup = () => {
          clearTimeout(timeout);
          image.removeEventListener('load', handleLoad);
          image.removeEventListener('error', handleError);
        };
        const handleLoad = () => {
          if (!image.complete || image.naturalWidth <= 0 || image.naturalHeight <= 0) return;
          cleanup();
          resolve();
        };
        const handleError = () => {
          cleanup();
          reject(new Error('Work image failed to load: ' + src));
        };

        image.addEventListener('load', handleLoad);
        image.addEventListener('error', handleError);
        timeout = setTimeout(() => {
          cleanup();
          reject(new Error('Timed out waiting for Work image: ' + src));
        }, 5000);

        image.loading = 'eager';
        image.scrollIntoView({ block: 'center' });
        handleLoad();
      });
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
  const expectedColumns = width <= 760 ? 1 : width <= 1100 ? 2 : 3;
  assert(workLayout.columns === expectedColumns, `Work grid uses ${expectedColumns} column(s) at ${width}px`);
  assert(workLayout.imagesReady && workLayout.imageMetadata, `Work images load with 1440×900 metadata and object-fit cover at ${width}px`);
  assert(workLayout.actionHeight >= 44, `Work action links are at least 44px high at ${width}px (measured ${workLayout.actionHeight}px)`);
  const apparel = await evaluate(`(() => {
    const showcases = [...document.querySelectorAll('.apparel-showcase')];
    const ctas = [...document.querySelectorAll('.apparel-showcase-cta')];
    const showcase = showcases[0];
    const cta = ctas[0];
    const automation = document.querySelector('.software-automation');
    const ctaStyle = cta ? getComputedStyle(cta) : null;
    const innerStyle = showcase ? getComputedStyle(showcase.querySelector('.apparel-showcase-inner')) : null;
    const rect = cta ? cta.getBoundingClientRect() : null;
    return {
      showcaseCount: showcases.length,
      ctaCount: ctas.length,
      href: cta ? cta.getAttribute('href') : '',
      target: cta ? cta.getAttribute('target') : '',
      rel: cta ? cta.getAttribute('rel').split(' ').filter(Boolean) : [],
      accessibleName: cta ? cta.getAttribute('aria-label') : '',
      visible: Boolean(rect && rect.width > 0 && rect.height > 0 && ctaStyle.display !== 'none' && ctaStyle.visibility !== 'hidden'),
      height: rect ? rect.height : 0,
      beforeAutomation: Boolean(showcase && automation && (showcase.compareDocumentPosition(automation) & Node.DOCUMENT_POSITION_FOLLOWING)),
      columns: innerStyle ? innerStyle.gridTemplateColumns.split(' ').length : 0,
      noOverflow: document.documentElement.scrollWidth === document.documentElement.clientWidth
    };
  })()`);
  assert(apparel.showcaseCount === 1, `Work page exposes exactly one Apparel showcase at ${width}px`);
  assert(apparel.ctaCount === 1, `Work page exposes exactly one Apparel CTA at ${width}px`);
  assert(apparel.href === 'https://lesleysacks.github.io/INTERSACKS_APPAREL_WEBSITE/', `Apparel CTA uses the exact storefront URL at ${width}px`);
  assert(apparel.target === '_blank', `Apparel CTA opens in a new tab at ${width}px`);
  assert(apparel.rel.includes('noopener') && apparel.rel.includes('noreferrer'), `Apparel CTA protects the external tab at ${width}px`);
  assert(apparel.accessibleName === 'Explore InterSacks Apparel website (opens in a new tab)', `Apparel CTA has a clear accessible name at ${width}px`);
  assert(apparel.visible, `Apparel CTA is visible at ${width}px`);
  assert(apparel.height >= 44, `Apparel CTA is at least 44px high at ${width}px (measured ${apparel.height}px)`);
  assert(apparel.beforeAutomation, `Apparel showcase appears before Software & Automation at ${width}px`);
  assert(apparel.columns === (width <= 760 ? 1 : 2), `Apparel showcase uses the intended layout at ${width}px`);
  assert(apparel.noOverflow, `Apparel showcase causes no horizontal overflow at ${width}px`);
  const greetingTemplates = await evaluate(`(() => {
    const group = document.querySelector('.greeting-card-templates');
    const independent = document.querySelector('#independent-concepts-title')?.closest('.project-group');
    const cards = [...document.querySelectorAll('.greeting-card-template')];
    const previews = [...document.querySelectorAll('.greeting-card-template .template-preview')];
    const downloads = [...document.querySelectorAll('.greeting-card-template .template-download')];
    const columns = group ? getComputedStyle(group.querySelector('.recent-projects-grid')).gridTemplateColumns.split(' ').length : 0;
    return {
      cards: cards.length,
      oldValentineCount: [...document.querySelectorAll('.recent-project-card h4')].filter((heading) => heading.textContent.trim() === 'Valentine’s Cards').length,
      afterIndependent: Boolean(group && independent && (independent.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING)),
      previews: previews.length,
      downloads: downloads.length,
      safePreviews: previews.every((link) => link.target === '_blank' && link.relList.contains('noopener') && link.relList.contains('noreferrer')),
      downloadable: downloads.every((link) => link.hasAttribute('download') && link.getAttribute('download').endsWith('.html')),
      matchingSources: cards.every((card) => card.querySelector('.template-preview')?.getAttribute('href') === card.querySelector('.template-download')?.getAttribute('href')),
      columns,
      downloadHeight: Math.min(...downloads.map((link) => link.getBoundingClientRect().height))
    };
  })()`);
  assert(greetingTemplates.cards === 2, `Work page exposes exactly two greeting-card template cards at ${width}px`);
  assert(greetingTemplates.oldValentineCount === 0, `Work page does not duplicate the old Valentine project card at ${width}px`);
  assert(greetingTemplates.afterIndependent, `Greeting templates appear after Independent Website Concepts at ${width}px`);
  assert(greetingTemplates.previews === 2 && greetingTemplates.safePreviews, `Both template previews open safely at ${width}px`);
  assert(greetingTemplates.downloads === 2 && greetingTemplates.downloadable, `Both templates provide descriptive HTML downloads at ${width}px`);
  assert(greetingTemplates.matchingSources, `Each template preview and download uses the same source at ${width}px`);
  assert(greetingTemplates.columns === (width <= 760 ? 1 : width <= 1100 ? 2 : 3), `Greeting templates use the established Work grid at ${width}px`);
  assert(greetingTemplates.downloadHeight >= 44, `Greeting template downloads are at least 44px high at ${width}px`);
}

const templateBase = `${baseUrl}/assets/templates/greeting-cards`;
const [birthdaySource, valentineSource, templateReadme, templateLicense] = await Promise.all([
  fetch(`${templateBase}/birthday-card-template.html`).then((response) => response.text()),
  fetch(`${templateBase}/valentine-card-template.html`).then((response) => response.text()),
  fetch(`${templateBase}/README.md`).then((response) => response.text()),
  fetch(`${templateBase}/LICENSE`).then((response) => response.text())
]);
const forbiddenTemplateMarkers = ['miss tammy', 'tammy rose', 't🌹r', 'les, neville', 'theveshni', 'us.png'];
assert([birthdaySource, valentineSource].every((source) => forbiddenTemplateMarkers.every((marker) => !source.toLowerCase().includes(marker))), 'Greeting templates contain no personal reference-card markers');
assert([birthdaySource, valentineSource].every((source) => source.includes('MIT License') && source.includes('Copyright (c) 2026 Lesley Sacks')), 'Both standalone template downloads retain the MIT notice');
assert(templateLicense.includes('MIT License') && templateLicense.includes('Copyright (c) 2026 Lesley Sacks'), 'Greeting-template directory includes the MIT License');
assert(templateReadme.includes('does **not** automatically license the rest of the InterSacks Digital website'), 'Greeting-template README clearly scopes the directory licence');
assert([birthdaySource, valentineSource].every((source) => source.includes('const CARD_CONFIG') && !source.includes('innerHTML')), 'Greeting templates centralize editable content and avoid innerHTML');

await navigate('assets/templates/greeting-cards/birthday-card-template.html');
const birthdayInitial = await evaluate(`(() => ({
  expanded: document.querySelector('#toggle').getAttribute('aria-expanded'),
  externalAssets: document.querySelectorAll('link[rel="stylesheet"], script[src], img').length,
  buttonHeight: document.querySelector('#toggle').getBoundingClientRect().height
}))()`);
assert(birthdayInitial.expanded === 'false' && birthdayInitial.externalAssets === 0, 'Birthday template starts closed and is fully self-contained');
assert(birthdayInitial.buttonHeight >= 44, 'Birthday template open control is at least 44px high');
await evaluate(`document.querySelector('#toggle').focus()`);
await evaluate(`document.querySelector('#toggle').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);
const birthdayOpened = await evaluate(`(() => ({ expanded: document.querySelector('#toggle').getAttribute('aria-expanded'), status: document.querySelector('#status').textContent }))()`);
assert(birthdayOpened.expanded === 'true' && birthdayOpened.status.includes('opened'), 'Birthday template opens by keyboard and announces its state');
await evaluate(`document.querySelector('#toggle').click()`);
const birthdayClosed = await evaluate(`(() => ({ expanded: document.querySelector('#toggle').getAttribute('aria-expanded'), status: document.querySelector('#status').textContent }))()`);
assert(birthdayClosed.expanded === 'false' && birthdayClosed.status.includes('closed'), 'Birthday template closes by pointer and announces its state');

await navigate('assets/templates/greeting-cards/valentine-card-template.html');
const valentineInitial = await evaluate(`(() => ({
  buttons: document.querySelectorAll('.actions button').length,
  placeholder: Boolean(document.querySelector('#placeholder')),
  images: document.querySelectorAll('img').length,
  externalAssets: document.querySelectorAll('link[rel="stylesheet"], script[src]').length
}))()`);
assert(valentineInitial.buttons === 2 && valentineInitial.placeholder && valentineInitial.images === 0 && valentineInitial.externalAssets === 0, 'Valentine template has two usable controls, a safe fallback, and no external assets');
await evaluate(`document.querySelector('#positive').focus()`);
await evaluate(`document.querySelector('#positive').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);
const positiveResponse = await evaluate(`document.querySelector('#response').textContent`);
assert(positiveResponse.includes('Wonderful'), 'Valentine positive response is keyboard actionable and updates the live region');
await evaluate(`document.querySelector('#secondary').click()`);
const secondaryResponse = await evaluate(`document.querySelector('#response').textContent`);
assert(secondaryResponse.includes('No pressure'), 'Valentine secondary response remains pointer actionable and updates the live region');

await send('Emulation.setEmulatedMedia', { media: 'screen', features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
await navigate('assets/templates/greeting-cards/birthday-card-template.html');
const birthdayReduced = await evaluate(`parseFloat(getComputedStyle(document.querySelector('.cover')).transitionDuration) <= 0.001`);
assert(birthdayReduced, 'Birthday template respects reduced-motion preferences');
await navigate('assets/templates/greeting-cards/valentine-card-template.html');
const valentineReduced = await evaluate(`parseFloat(getComputedStyle(document.querySelector('#positive')).transitionDuration) <= 0.001`);
assert(valentineReduced, 'Valentine template respects reduced-motion preferences');
await send('Emulation.setEmulatedMedia', { media: 'screen', features: [] });

await navigate('resources.html');
const resourceHub = await evaluate(`(() => {
  const cards = [...document.querySelectorAll('[data-resource-card]')];
  const search = document.querySelector('#resource-search');
  search.value = 'sitemap';
  search.dispatchEvent(new Event('input', { bubbles: true }));
  const sitemapMatches = cards.filter((card) => !card.hidden).length;

  document.querySelector('[data-reset-resources]').click();
  document.querySelector('[data-filter="brand"]').click();
  const brandMatches = cards.filter((card) => !card.hidden);
  const brandOnly = brandMatches.every((card) => card.dataset.category.split(' ').filter(Boolean).includes('brand'));

  document.querySelector('[data-reset-resources]').click();
  return {
    cardCount: cards.length,
    sitemapMatches,
    brandCount: brandMatches.length,
    brandOnly,
    restoredCount: cards.filter((card) => !card.hidden).length,
    downloads: document.querySelectorAll('a[download]').length,
    copyControls: document.querySelectorAll('[data-copy], [data-copy-target]').length,
    hasLiveStatus: Boolean(document.querySelector('[data-result-count][aria-live], [data-copy-toast][aria-live]'))
  };
})()`);
assert(resourceHub.cardCount >= 18, 'Resource Hub exposes at least 18 useful resources');
assert(resourceHub.sitemapMatches === 1, 'Resource Hub search isolates the sitemap automation');
assert(resourceHub.brandCount >= 8 && resourceHub.brandOnly, 'Resource Hub brand filter shows only brand resources');
assert(resourceHub.restoredCount === resourceHub.cardCount, 'Resource Hub reset restores every resource');
assert(resourceHub.downloads === 5, 'Resource Hub provides three Python and two planning downloads');
assert(resourceHub.copyControls >= 9 && resourceHub.hasLiveStatus, 'Resource Hub copy controls provide accessible status feedback');

await evaluate(`(() => {
  try {
    const storage = window.sessionStorage;
    if (storage && typeof storage.clear === 'function') storage.clear();
  } catch (error) { }
})()`);
await navigate('index.html');
const loaderChecks = await evaluate(`(() => {
  const loader = document.querySelector('#site-loader');
  const logo = loader && loader.querySelector('.site-loader-logo');
  const name = loader && loader.querySelector('.site-loader-name');
  const progress = loader && loader.querySelector('.site-loader-progress');
  return {
    loaderPresent: Boolean(loader),
    loaderLogo: Boolean(logo),
    logoSource: logo ? new URL(logo.getAttribute('src'), window.location.href).pathname.endsWith('/favicon.svg') : false,
    logoAlt: logo ? logo.getAttribute('alt') : '',
    logoAriaHidden: logo ? logo.getAttribute('aria-hidden') : '',
    logoWidth: logo ? Number.parseInt(logo.getAttribute('width'), 10) : 0,
    logoHeight: logo ? Number.parseInt(logo.getAttribute('height'), 10) : 0,
    logoNaturalWidth: logo ? logo.naturalWidth : 0,
    logoNaturalHeight: logo ? logo.naturalHeight : 0,
    oldMarkAbsent: !document.querySelector('.site-loader-mark'),
    labelVisible: Boolean(name && name.textContent.trim()),
    progressVisible: Boolean(progress),
    pageReady: document.documentElement.classList.contains('page-ready')
  };
})()`);
assert(loaderChecks.loaderPresent && loaderChecks.loaderLogo && loaderChecks.logoSource, 'Homepage loader uses favicon.svg');
assert(loaderChecks.oldMarkAbsent, 'Text-based homepage loader mark is removed');
assert(loaderChecks.logoAlt === '' && loaderChecks.logoAriaHidden === 'true', 'Loader logo uses empty alt text and aria-hidden');
assert(loaderChecks.logoWidth > 0 && loaderChecks.logoHeight > 0 && loaderChecks.logoNaturalWidth > 0 && loaderChecks.logoNaturalHeight > 0, 'Loader logo has positive dimensions');
assert(loaderChecks.labelVisible && loaderChecks.progressVisible, 'Loader exposes visible label text and progress indicator');
assert(loaderChecks.pageReady, 'Homepage is revealed once the loader has initialized');

await evaluate(`(() => {
  try {
    const storage = window.sessionStorage;
    if (storage && typeof storage.clear === 'function') storage.clear();
  } catch (error) { }
})()`);
await navigate('index.html');
const initialLoaderState = await evaluate(`(() => {
  const loader = document.querySelector('#site-loader');
  return loader ? {
    display: getComputedStyle(loader).display,
    visibility: getComputedStyle(loader).visibility,
    opacity: getComputedStyle(loader).opacity,
    pageReady: document.documentElement.classList.contains('page-ready')
  } : null;
})()`);
assert(initialLoaderState && initialLoaderState.display !== 'none' && initialLoaderState.visibility === 'visible', 'First homepage visit shows the loader');
await sleep(2100);
const dismissedLoaderState = await evaluate(`(() => {
  const loader = document.querySelector('#site-loader');
  return loader ? {
    hidden: loader.hasAttribute('hidden'),
    classHidden: loader.classList.contains('is-hidden'),
    visibility: getComputedStyle(loader).visibility,
    opacity: getComputedStyle(loader).opacity,
    pageReady: document.documentElement.classList.contains('page-ready')
  } : { removed: true, pageReady: document.documentElement.classList.contains('page-ready') };
})()`);
assert(dismissedLoaderState && (dismissedLoaderState.hidden || dismissedLoaderState.classHidden || dismissedLoaderState.opacity === '0' || dismissedLoaderState.visibility === 'hidden' || dismissedLoaderState.removed) && dismissedLoaderState.pageReady, 'First visit dismisses the loader and reveals the page');

await evaluate(`(() => {
  try {
    const storage = window.sessionStorage;
    if (storage && typeof storage.setItem === 'function') storage.setItem('intersacks-loader-shown', 'true');
  } catch (error) { }
})()`);
await navigate('index.html');
const secondVisitLoaderState = await evaluate(`(() => {
  const loader = document.querySelector('#site-loader');
  return {
    missing: !loader,
    pageReady: document.documentElement.classList.contains('page-ready'),
    sessionState: window.sessionStorage.getItem('intersacks-loader-shown')
  };
})()`);
assert(secondVisitLoaderState.missing && secondVisitLoaderState.pageReady && secondVisitLoaderState.sessionState === 'true', 'Second homepage visit in the same session skips the loader');

await send('Page.addScriptToEvaluateOnNewDocument', { source: 'Object.defineProperty(window, "sessionStorage", { configurable: true, get: () => { throw new Error("sessionStorage unavailable"); } });' });
await navigate('index.html');
const storageFailureState = await evaluate(`(() => ({
  pageReady: document.documentElement.classList.contains('page-ready'),
  contentVisible: getComputedStyle(document.querySelector('main')).opacity !== '0'
}))()`);
assert(storageFailureState.pageReady && storageFailureState.contentVisible, 'SessionStorage failure does not break the homepage');

await send('Page.addScriptToEvaluateOnNewDocument', { source: 'Object.defineProperty(window, "sessionStorage", { configurable: true, get: () => window.__sessionStorageFallback__ || (window.__sessionStorageFallback__ = { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {} }) });' });
await evaluate(`(() => {
  try {
    const storage = window.sessionStorage;
    if (storage && typeof storage.clear === 'function') storage.clear();
  } catch (error) { }
})()`);
await navigate('index.html');
await sleep(2600);
const safetyTimeoutState = await evaluate(`(() => ({
  pageReady: document.documentElement.classList.contains('page-ready'),
  loaderHidden: !document.querySelector('#site-loader') || document.querySelector('#site-loader').hasAttribute('hidden')
}))()`);
assert(safetyTimeoutState.pageReady && safetyTimeoutState.loaderHidden, 'Safety timeout releases the page without leaving it inert');

await send('Emulation.setScriptExecutionDisabled', { value: true });
await navigate('index.html');
const noScriptReveal = await evaluate(`(() => {
  const reveal = document.querySelector('.reveal');
  return !document.documentElement.classList.contains('js') && getComputedStyle(reveal).opacity === '1';
})()`);
assert(noScriptReveal, 'Reveal content remains visible when JavaScript is disabled');
await send('Emulation.setScriptExecutionDisabled', { value: false });

await send('Emulation.setEmulatedMedia', { media: 'screen', features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
await send('Page.addScriptToEvaluateOnNewDocument', { source: 'Object.defineProperty(window, "sessionStorage", { configurable: true, get: () => ({ getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {} }) });' });
await navigate('index.html');
const reducedMotion = await evaluate(`(() => {
  const loader = document.querySelector('#site-loader');
  const reveal = document.querySelector('.reveal');
  const loaderLogo = loader && loader.querySelector('.site-loader-logo');
  const revealStyle = getComputedStyle(reveal);
  const loaderStyle = loaderLogo ? getComputedStyle(loaderLogo) : null;
  return {
    loaderPresent: Boolean(loader),
    loaderHidden: !loader || loader.hasAttribute('hidden') || getComputedStyle(loader).visibility === 'hidden' || getComputedStyle(loader).opacity === '0',
    revealOpacity: revealStyle.opacity,
    revealTransform: revealStyle.transform,
    revealDuration: parseFloat(revealStyle.transitionDuration),
    logoAnimation: loaderStyle ? loaderStyle.animationName : 'not-applicable',
    logoOpacity: loaderStyle ? loaderStyle.opacity : 'not-applicable'
  };
})()`);
assert(reducedMotion.revealOpacity === '1' && reducedMotion.revealTransform === 'none' && reducedMotion.revealDuration <= 0.001 && (reducedMotion.loaderHidden || (reducedMotion.loaderPresent && reducedMotion.logoAnimation === 'none' && reducedMotion.logoOpacity === '1')), 'Reduced-motion mode keeps reveal content visible without motion and disables loader animation');
await send('Emulation.setEmulatedMedia', { media: 'screen', features: [] });

await navigate('index.html');
const linkBehaviour = await evaluate(`(() => {
  const originalSetTimeout = window.setTimeout;
  const originalClearTimeout = window.clearTimeout;
  const scheduled = [];
  window.setTimeout = (callback, delay) => {
    scheduled.push({ callback, delay });
    return scheduled.length;
  };
  window.clearTimeout = () => {};
  const makeLink = (href, attributes = {}) => {
    const link = document.createElement('a');
    link.href = href;
    Object.entries(attributes).forEach(([name, value]) => link.setAttribute(name, value));
    link.textContent = 'test link';
    document.body.append(link);
    return link;
  };
  const dispatch = (link, options = {}) => {
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...options });
    link.dispatchEvent(event);
    link.remove();
    return event.defaultPrevented;
  };
  const eligible = makeLink('about.html');
  const firstEligiblePrevented = dispatch(eligible);
  const firstEligibleTransitioned = document.documentElement.classList.contains('page-leaving');
  const secondEligiblePrevented = dispatch(makeLink('services.html'));
  const excluded = [
    dispatch(makeLink('assets/resources/python/static_site_scaffold.py', { download: '' })),
    dispatch(makeLink('#main')),
    dispatch(makeLink('https://example.com/')),
    dispatch(makeLink('mailto:test@example.com')),
    dispatch(makeLink('tel:+27123456789')),
    dispatch(makeLink('https://wa.me/27843252262')),
    dispatch(makeLink('contact.html', { target: '_blank' })),
    dispatch(makeLink('work.html'), { ctrlKey: true })
  ];
  window.setTimeout = originalSetTimeout;
  window.clearTimeout = originalClearTimeout;
  document.documentElement.classList.remove('page-leaving');
  document.documentElement.classList.add('page-ready');
  return {
    firstEligiblePrevented,
    firstEligibleTransitioned,
    secondEligiblePrevented,
    scheduledDelays: scheduled.map(({ delay }) => delay),
    excluded
  };
})()`);
assert(linkBehaviour.firstEligiblePrevented && linkBehaviour.firstEligibleTransitioned && linkBehaviour.scheduledDelays.length === 1 && linkBehaviour.scheduledDelays[0] === 180, 'Eligible primary-page clicks are prevented and enter a 180ms transition');
assert(!linkBehaviour.secondEligiblePrevented && linkBehaviour.scheduledDelays.length === 1, 'Rapid repeated primary-page clicks schedule only one navigation');
assert(linkBehaviour.excluded.every((prevented) => !prevented), 'Downloads, anchors, external, mailto, tel, WhatsApp, new-tab and modified clicks are not prevented');

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

await send('Emulation.setEmulatedMedia', { media: 'screen', features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
await navigate('assets/whatsapp_order_builder.html');
const orderBuilderReducedMotion = await evaluate(`(() => {
  const style = getComputedStyle(document.querySelector('.button'));
  return getComputedStyle(document.documentElement).scrollBehavior === 'auto' && parseFloat(style.transitionDuration) <= 0.001;
})()`);
assert(orderBuilderReducedMotion, 'WhatsApp Order Builder respects reduced-motion preferences');
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
    orderBuilderLink: document.querySelector('a[href="assets/whatsapp_order_builder.html"]')?.textContent.trim(),
    orderBuilderImage: document.querySelector('img[src="assets/images/projects/whatsapp-order-builder.webp"]')?.getAttribute('alt'),
    wonderAlt: document.querySelector('img[src$="wondercubs-studio.webp"]').alt,
    text: document.body.innerText,
    externalLinksValid: [...document.querySelectorAll('a[href^="http"]')].every((link) => link.target === '_blank' && link.relList.contains('noopener') && link.relList.contains('noreferrer'))
  };
})()`);
assert(workContent.featured.join('|') === 'Generative A.I — Industrial Automation|Sticky Notes Capstone|WonderCubs Studio — In Development', 'Featured Work uses the specified order and status');
assert(workContent.recent.join('|') === 'SNA Cleaning Services|AJ Air Systems|Lee’s Nail It Salon|Ultimate Liquors|Cay Accessories|D’vine Funeral Home|Valentine Card Template|Birthday Flip Card Template', 'Recent Projects preserves six independent concepts followed by the two reusable greeting templates');
assert(workContent.software.join('|') === 'Invoice Generator|Quote Generator|Job Card Generator|WhatsApp Order Builder', 'Software & Automation contains all four working browser tools in order');
assert(workContent.jobCardLink === 'Open Live Tool ↗' && /Job Card Generator/.test(workContent.jobCardImage), 'Job Card Work card uses the correct local tool link and meaningful screenshot alt text');
assert(workContent.orderBuilderLink === 'Open Live Tool ↗' && /WhatsApp Order Builder/.test(workContent.orderBuilderImage), 'WhatsApp Order Builder Work card uses the correct local tool link and meaningful screenshot alt text');
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

await navigate('assets/whatsapp_order_builder.html');
await waitFor('Boolean(window.whatsAppOrderBuilder)');
const orderBuilder = await evaluate(`(async () => {
  const api = window.whatsAppOrderBuilder;
  const form = document.querySelector('#order-form');
  const setValue = (selector, value, root = document) => {
    const control = root.querySelector(selector);
    control.value = value;
    control.dispatchEvent(new Event('input', { bubbles: true }));
    control.dispatchEvent(new Event('change', { bubbles: true }));
    return control;
  };
  const setFulfilment = (value) => {
    const control = document.querySelector('input[name="fulfilment"][value="' + value + '"]');
    control.checked = true;
    control.dispatchEvent(new Event('input', { bubbles: true }));
    control.dispatchEvent(new Event('change', { bubbles: true }));
    return control;
  };
  const rows = () => [...document.querySelectorAll('.item-row')];
  const resetRows = () => {
    rows().slice(1).forEach((row) => row.remove());
    const row = rows()[0] || api.addItem();
    setValue('.item-description', 'Sample service item', row);
    setValue('.item-variant', 'Standard option', row);
    setValue('.item-quantity', '1', row);
    setValue('.item-price', '1.00', row);
    api.calculateTotals();
    return row;
  };
  const completeDetails = () => {
    setValue('#business-name', 'Sample Test Business');
    setValue('#whatsapp-number', '084 325 2262');
    setValue('#order-instructions', 'Please confirm preparation timing.');
    setValue('#customer-name', 'Sample Customer');
    setValue('#customer-phone', '082 000 0000');
    setValue('#order-number', 'ORD-2026-001');
    setValue('#order-date', '2026-08-23');
    setValue('#requested-date', '2026-08-25');
    setValue('#requested-time', '13:30');
    setValue('#customer-notes', 'Please package items separately.');
    setFulfilment('Collection');
    resetRows();
  };
  const rejectsPhone = (input) => {
    try { api.normalizePhoneNumber(input); return false; } catch { return true; }
  };

  const initialState = {
    rowCount: rows().length,
    removeHidden: rows()[0].querySelector('.remove-button').hidden,
    number: document.querySelector('#order-number').value,
    hasOrderDate: Boolean(document.querySelector('#order-date').value),
    hasRequestedDate: Boolean(document.querySelector('#requested-date').value),
    collectionChecked: document.querySelector('#fulfilment-collection').checked,
    deliveryHidden: document.querySelector('#delivery-fields').hidden,
    deliveryAddressDisabled: document.querySelector('#delivery-address').disabled,
    deliveryFeeDisabled: document.querySelector('#delivery-fee').disabled,
    deliveryFee: document.querySelector('#delivery-fee').value,
    destinationBlank: document.querySelector('#whatsapp-number').value === '',
    privacyNotice: document.body.innerText.includes('Order information remains in this browser session') && document.body.innerText.includes('does not upload or store it') && document.body.innerText.includes('WhatsApp’s terms and privacy practices'),
    boundaryNotice: document.body.innerText.includes('order request only') && document.body.innerText.includes('No stock is reserved') && document.body.innerText.includes('no payment is processed') && document.body.innerText.includes('does not prove the message was sent or received'),
    forbiddenControls: Boolean(document.querySelector('[name*="tax" i], [name*="discount" i], [name*="deposit" i], [name*="payment" i], [name*="card" i]')),
    minimumTargetHeight: Math.min(...[...document.querySelectorAll('button, a, input:not([type="radio"]), textarea, .radio-field label')]
      .filter((control) => control.getClientRects().length)
      .map((control) => control.getBoundingClientRect().height))
  };

  const phoneResults = {
    local: api.normalizePhoneNumber('084 325 2262'),
    plusInternational: api.normalizePhoneNumber('+27 84 325 2262'),
    directInternational: api.normalizePhoneNumber('27843252262'),
    formatted: api.normalizePhoneNumber('(084)-325-2262'),
    foreignUnchanged: api.normalizePhoneNumber('+44 20 7946 0958'),
    rejectsLetters: rejectsPhone('084 ABC 2262'),
    rejectsMisplacedPlus: rejectsPhone('27+843252262'),
    rejectsRepeatedPlus: rejectsPhone('++27843252262'),
    rejectsShort: rejectsPhone('1234567'),
    rejectsLong: rejectsPhone('1234567890123456'),
    rejectsDoubleZero: rejectsPhone('0027843252262')
  };

  document.querySelector('#add-item-button').click();
  const addedRowCount = rows().length;
  const secondRemoveVisible = !rows()[1].querySelector('.remove-button').hidden;
  rows()[1].querySelector('.remove-button').click();
  const removedRowCount = rows().length;
  const retainedRemoveHidden = rows()[0].querySelector('.remove-button').hidden;

  completeDetails();
  let reportValidityCalls = 0;
  const originalReportValidity = form.reportValidity.bind(form);
  form.reportValidity = () => { reportValidityCalls += 1; return originalReportValidity(); };

  let row = resetRows();
  setValue('.item-quantity', '2.5', row);
  setValue('.item-price', '99.99', row);
  const decimalTotals = api.calculateTotals();
  const decimalLine = {
    amount: row.querySelector('.item-amount').value,
    subtotalCents: decimalTotals.subtotalCents,
    totalCents: decimalTotals.totalCents
  };
  api.addItem({ description: 'Decimal item two', variant: 'Medium', quantity: 1.25, unitPrice: 10.01 });
  api.addItem({ description: 'Decimal item three', quantity: 3.5, unitPrice: 0.10 });
  const multipleTotals = api.calculateTotals();

  setFulfilment('Delivery');
  setValue('#delivery-address', '10 Example Avenue, Paarl');
  setValue('#delivery-fee', '35.55');
  const deliveryTotals = api.calculateTotals();
  const deliveryState = {
    shown: !document.querySelector('#delivery-fields').hidden,
    addressEnabled: !document.querySelector('#delivery-address').disabled,
    addressRequired: document.querySelector('#delivery-address').required,
    feeEnabled: !document.querySelector('#delivery-fee').disabled,
    feeCents: deliveryTotals.deliveryFeeCents,
    totalCents: deliveryTotals.totalCents
  };
  setFulfilment('Collection');
  const collectionTotals = api.calculateTotals();
  const collectionState = {
    hidden: document.querySelector('#delivery-fields').hidden,
    addressDisabled: document.querySelector('#delivery-address').disabled,
    feeDisabled: document.querySelector('#delivery-fee').disabled,
    feeValue: document.querySelector('#delivery-fee').value,
    feeCents: collectionTotals.deliveryFeeCents,
    totalCents: collectionTotals.totalCents
  };

  const originalOpen = window.open;
  let invalidOpenCalls = 0;
  window.open = () => { invalidOpenCalls += 1; return { opener: null }; };
  completeDetails();

  setFulfilment('Delivery');
  setValue('#delivery-address', '');
  const deliveryWithoutAddressValid = api.validateForm();
  const deliveryWithoutAddressOpen = api.openWhatsApp();
  setValue('#delivery-address', '10 Example Avenue, Paarl');
  setValue('#delivery-fee', '-1');
  const negativeDeliveryFeeValid = api.validateForm();
  const negativeDeliveryFeeOpen = api.openWhatsApp();
  setValue('#delivery-fee', '10000000');
  const excessiveDeliveryFeeValid = api.validateForm();
  const excessiveDeliveryFeeOpen = api.openWhatsApp();
  setValue('#delivery-fee', '35.00');

  setValue('#requested-date', '2026-08-22');
  const invalidDateValid = api.validateForm();
  const invalidDateOpen = api.openWhatsApp();
  setValue('#requested-date', '2026-08-25');
  setValue('#whatsapp-number', '084 INVALID');
  const invalidPhoneValid = api.validateForm();
  const invalidPhoneOpen = api.openWhatsApp();
  setValue('#whatsapp-number', '084 325 2262');

  row = resetRows();
  setValue('.item-quantity', '0', row);
  const zeroQuantityValid = api.validateForm();
  const zeroQuantityOpen = api.openWhatsApp();
  row = resetRows();
  setValue('.item-quantity', '-1', row);
  const negativeQuantityValid = api.validateForm();
  const negativeQuantityOpen = api.openWhatsApp();
  row = resetRows();
  setValue('.item-quantity', 'not-a-number', row);
  const nonNumericQuantityValid = api.validateForm();
  const nonNumericQuantityOpen = api.openWhatsApp();
  row = resetRows();
  setValue('.item-quantity', '1000001', row);
  const excessiveQuantityValid = api.validateForm();
  const excessiveQuantityOpen = api.openWhatsApp();
  row = resetRows();
  setValue('.item-price', '0', row);
  const zeroPriceValid = api.validateForm();
  const zeroPriceOpen = api.openWhatsApp();
  row = resetRows();
  setValue('.item-price', '-1', row);
  const negativePriceValid = api.validateForm();
  const negativePriceOpen = api.openWhatsApp();
  row = resetRows();
  setValue('.item-price', 'not-a-number', row);
  const nonNumericPriceValid = api.validateForm();
  const nonNumericPriceOpen = api.openWhatsApp();
  row = resetRows();
  setValue('.item-price', '10000000', row);
  const excessivePriceValid = api.validateForm();
  const excessivePriceOpen = api.openWhatsApp();
  row = resetRows();
  setValue('.item-description', '', row);
  const blankDescriptionValid = api.validateForm();
  const blankDescriptionOpen = api.openWhatsApp();

  completeDetails();
  rows().forEach((itemRow) => itemRow.remove());
  const noItemsValid = api.validateForm();
  const noItemsOpen = api.openWhatsApp();

  completeDetails();
  rows().slice(1).forEach((itemRow) => itemRow.remove());
  row = rows()[0];
  setValue('.item-description', 'Length-limit item '.repeat(10), row);
  setValue('.item-variant', 'Detailed variant '.repeat(5), row);
  setValue('.item-quantity', '1', row);
  setValue('.item-price', '1.00', row);
  for (let index = 1; index < 22; index += 1) {
    api.addItem({
      description: 'Length-limit item description '.repeat(7) + index,
      variant: 'Detailed variant option '.repeat(3),
      quantity: 1,
      unitPrice: 1
    });
  }
  const longMessage = api.buildOrderMessage(api.collectOrderData());
  const longMessageValid = api.validateForm();
  const longMessageOpen = api.openWhatsApp();
  const lengthMessage = document.querySelector('#form-message').textContent;
  const invalidOpenCount = invalidOpenCalls;
  window.open = originalOpen;

  completeDetails();
  setFulfilment('Delivery');
  setValue('#delivery-address', '10 Example Avenue, Paarl');
  setValue('#delivery-fee', '35.00');
  row = resetRows();
  setValue('.item-description', 'Sample product bundle', row);
  setValue('.item-variant', 'Standard option', row);
  setValue('.item-quantity', '2.5', row);
  setValue('.item-price', '99.99', row);
  setValue('#order-number', 'ORD-2026-014');
  const previewed = api.previewOrder();
  const previewFocused = document.activeElement.id === 'preview-title';
  const preparedData = api.collectOrderData();
  const preparedMessage = api.buildOrderMessage(preparedData);
  const preparedUrl = api.buildWhatsAppUrl(preparedData.destinationNumber, preparedMessage);
  const previewText = document.querySelector('#preview-document').textContent;
  const messagePreview = document.querySelector('.message-preview').textContent;
  const decodedMessage = decodeURIComponent(preparedUrl.split('text=')[1]);
  const prohibitedClaims = /Order confirmed|Order accepted|Stock reserved|Payment received|Payment successful|Order submitted successfully/i.test(preparedMessage);

  const originalClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  const copiedMessages = [];
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async (text) => { copiedMessages.push(text); } }
  });
  const copiedResult = await api.copyOrderMessage();

  const originalExecCommand = document.execCommand;
  let fallbackText = '';
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async () => { throw new Error('Clipboard denied'); } }
  });
  document.execCommand = () => {
    fallbackText = document.activeElement?.value || '';
    return true;
  };
  const fallbackCopyResult = await api.copyOrderMessage();
  document.execCommand = () => false;
  const failedCopyResult = await api.copyOrderMessage();
  const failedCopyMessage = document.querySelector('#form-message').textContent;
  document.execCommand = originalExecCommand;
  if (originalClipboardDescriptor) Object.defineProperty(navigator, 'clipboard', originalClipboardDescriptor);
  else delete navigator.clipboard;

  const openCalls = [];
  const openedContext = { opener: 'unsafe' };
  window.open = (url, target, features) => {
    openCalls.push({ url, target, features });
    return openedContext;
  };
  const openedUrl = api.openWhatsApp();
  const openUiMessage = document.querySelector('#form-message').textContent;
  window.open = originalOpen;

  setValue('.item-description', '<img src=x onerror=alert(1)>', row);
  setValue('#customer-notes', '<script>alert(1)<\\/script>');
  const safePreview = api.previewOrder();
  const safePreviewText = document.querySelector('#preview-document').textContent;
  const unsafePreviewNodes = document.querySelector('#preview-document img, #preview-document script, #preview-document iframe');

  setValue('#business-name', 'Keep this value');
  const originalConfirm = window.confirm;
  window.confirm = () => false;
  const cancelledReset = api.resetOrder();
  const cancelledResetPreserved = document.querySelector('#business-name').value === 'Keep this value';
  window.confirm = () => true;
  const confirmedReset = api.resetOrder();
  const resetState = {
    businessName: document.querySelector('#business-name').value,
    destinationNumber: document.querySelector('#whatsapp-number').value,
    customerName: document.querySelector('#customer-name').value,
    rowCount: rows().length,
    description: rows()[0].querySelector('.item-description').value,
    quantity: rows()[0].querySelector('.item-quantity').value,
    collectionChecked: document.querySelector('#fulfilment-collection').checked,
    deliveryHidden: document.querySelector('#delivery-fields').hidden,
    deliveryAddressDisabled: document.querySelector('#delivery-address').disabled,
    deliveryFeeDisabled: document.querySelector('#delivery-fee').disabled,
    deliveryFee: document.querySelector('#delivery-fee').value,
    previewHidden: document.querySelector('#preview-document').hidden,
    focused: document.activeElement.id,
    hasOrderDate: Boolean(document.querySelector('#order-date').value),
    hasRequestedDate: Boolean(document.querySelector('#requested-date').value),
    number: document.querySelector('#order-number').value
  };
  window.confirm = originalConfirm;

  return {
    initialState,
    phoneResults,
    addedRowCount,
    secondRemoveVisible,
    removedRowCount,
    retainedRemoveHidden,
    decimalLine,
    multipleTotals,
    deliveryState,
    collectionState,
    deliveryWithoutAddressValid,
    deliveryWithoutAddressOpen,
    negativeDeliveryFeeValid,
    negativeDeliveryFeeOpen,
    excessiveDeliveryFeeValid,
    excessiveDeliveryFeeOpen,
    invalidDateValid,
    invalidDateOpen,
    invalidPhoneValid,
    invalidPhoneOpen,
    zeroQuantityValid,
    zeroQuantityOpen,
    negativeQuantityValid,
    negativeQuantityOpen,
    nonNumericQuantityValid,
    nonNumericQuantityOpen,
    excessiveQuantityValid,
    excessiveQuantityOpen,
    zeroPriceValid,
    zeroPriceOpen,
    negativePriceValid,
    negativePriceOpen,
    nonNumericPriceValid,
    nonNumericPriceOpen,
    excessivePriceValid,
    excessivePriceOpen,
    blankDescriptionValid,
    blankDescriptionOpen,
    noItemsValid,
    noItemsOpen,
    rejectsNonFinite: api.parseQuantity(Infinity) === null && api.parseQuantity(-Infinity) === null && api.parseMoneyCents(Infinity) === null && api.calculateLineCents(Infinity, 1) === null && api.calculateLineCents(1, Infinity) === null,
    longMessageLength: longMessage.length,
    longMessageValid,
    longMessageOpen,
    lengthMessage,
    invalidOpenCount,
    reportValidityCalls,
    previewed,
    previewFocused,
    preparedData,
    preparedMessage,
    preparedUrl,
    decodedMessage,
    messagePreview,
    previewText,
    prohibitedClaims,
    copiedResult,
    copiedMessage: copiedMessages[0],
    fallbackCopyResult,
    fallbackText,
    failedCopyResult,
    failedCopyMessage,
    openedUrl,
    openCalls,
    openedOpener: openedContext.opener,
    openUiMessage,
    safePreview,
    safePreviewText,
    unsafePreviewNodes: Boolean(unsafePreviewNodes),
    cancelledReset,
    cancelledResetPreserved,
    confirmedReset,
    resetState
  };
})()`);

assert(orderBuilder.initialState.rowCount === 1 && orderBuilder.initialState.removeHidden && /^ORD-\d{4}-001$/.test(orderBuilder.initialState.number) && orderBuilder.initialState.hasOrderDate && orderBuilder.initialState.hasRequestedDate && orderBuilder.initialState.destinationBlank, 'WhatsApp Order Builder starts with one retained item, editable generated number, dates and no prefilled destination number');
assert(orderBuilder.initialState.collectionChecked && orderBuilder.initialState.deliveryHidden && orderBuilder.initialState.deliveryAddressDisabled && orderBuilder.initialState.deliveryFeeDisabled && orderBuilder.initialState.deliveryFee === '0.00', 'WhatsApp Order Builder defaults to Collection with delivery controls hidden, disabled and zeroed');
assert(orderBuilder.initialState.privacyNotice && orderBuilder.initialState.boundaryNotice && !orderBuilder.initialState.forbiddenControls, 'WhatsApp Order Builder states browser-session privacy and request boundaries without checkout or payment controls');
assert(orderBuilder.initialState.minimumTargetHeight >= 44, 'WhatsApp Order Builder interactive targets are at least 44px high');
assert(orderBuilder.phoneResults.local === '27843252262' && orderBuilder.phoneResults.plusInternational === '27843252262' && orderBuilder.phoneResults.directInternational === '27843252262' && orderBuilder.phoneResults.formatted === '27843252262', 'WhatsApp number normalization handles South African local and international readable formats');
assert(orderBuilder.phoneResults.foreignUnchanged === '442079460958' && orderBuilder.phoneResults.rejectsLetters && orderBuilder.phoneResults.rejectsMisplacedPlus && orderBuilder.phoneResults.rejectsRepeatedPlus && orderBuilder.phoneResults.rejectsShort && orderBuilder.phoneResults.rejectsLong && orderBuilder.phoneResults.rejectsDoubleZero, 'WhatsApp number normalization preserves valid foreign country codes and rejects malformed numbers');
assert(orderBuilder.addedRowCount === 2 && orderBuilder.secondRemoveVisible && orderBuilder.removedRowCount === 1 && orderBuilder.retainedRemoveHidden, 'WhatsApp Order Builder adds and removes item rows while retaining one row');
assert(orderBuilder.decimalLine.amount === 'R249.98' && orderBuilder.decimalLine.subtotalCents === 24998 && orderBuilder.decimalLine.totalCents === 24998, 'Order line calculates 2.5 × R99.99 as R249.98 using integer cents');
assert(orderBuilder.multipleTotals.subtotalCents === 26284 && orderBuilder.multipleTotals.totalCents === 26284, 'Multiple decimal order rows remain cent-accurate at R262.84');
assert(orderBuilder.deliveryState.shown && orderBuilder.deliveryState.addressEnabled && orderBuilder.deliveryState.addressRequired && orderBuilder.deliveryState.feeEnabled && orderBuilder.deliveryState.feeCents === 3555 && orderBuilder.deliveryState.totalCents === 29839, 'Delivery reveals and requires its address while adding the R35.55 fee exactly once');
assert(orderBuilder.collectionState.hidden && orderBuilder.collectionState.addressDisabled && orderBuilder.collectionState.feeDisabled && orderBuilder.collectionState.feeValue === '0.00' && orderBuilder.collectionState.feeCents === 0 && orderBuilder.collectionState.totalCents === 26284, 'Collection hides, disables and zeroes delivery fields without changing the item subtotal');
assert(!orderBuilder.deliveryWithoutAddressValid && !orderBuilder.deliveryWithoutAddressOpen && !orderBuilder.negativeDeliveryFeeValid && !orderBuilder.negativeDeliveryFeeOpen && !orderBuilder.excessiveDeliveryFeeValid && !orderBuilder.excessiveDeliveryFeeOpen, 'Delivery requires an address and rejects invalid or excessive fees without opening WhatsApp');
assert(!orderBuilder.invalidDateValid && !orderBuilder.invalidDateOpen && !orderBuilder.invalidPhoneValid && !orderBuilder.invalidPhoneOpen, 'Earlier requested dates and malformed destination numbers block WhatsApp opening');
assert(!orderBuilder.zeroQuantityValid && !orderBuilder.zeroQuantityOpen && !orderBuilder.negativeQuantityValid && !orderBuilder.negativeQuantityOpen && !orderBuilder.nonNumericQuantityValid && !orderBuilder.nonNumericQuantityOpen && !orderBuilder.excessiveQuantityValid && !orderBuilder.excessiveQuantityOpen, 'WhatsApp Order Builder rejects zero, negative, non-numeric and excessive quantities');
assert(!orderBuilder.zeroPriceValid && !orderBuilder.zeroPriceOpen && !orderBuilder.negativePriceValid && !orderBuilder.negativePriceOpen && !orderBuilder.nonNumericPriceValid && !orderBuilder.nonNumericPriceOpen && !orderBuilder.excessivePriceValid && !orderBuilder.excessivePriceOpen, 'WhatsApp Order Builder rejects zero, negative, non-numeric and excessive unit prices');
assert(!orderBuilder.zeroPriceValid && !orderBuilder.zeroPriceOpen, 'A zero-total order request is blocked before WhatsApp can open');
assert(!orderBuilder.blankDescriptionValid && !orderBuilder.blankDescriptionOpen && !orderBuilder.noItemsValid && !orderBuilder.noItemsOpen && orderBuilder.rejectsNonFinite, 'WhatsApp Order Builder rejects blank descriptions, requests without items and non-finite calculations');
assert(orderBuilder.longMessageLength > 4000 && !orderBuilder.longMessageValid && !orderBuilder.longMessageOpen && /exceeds 4000 characters/i.test(orderBuilder.lengthMessage), 'WhatsApp Order Builder blocks messages over the 4,000-character limit');
assert(orderBuilder.invalidOpenCount === 0, 'Invalid order requests never call window.open');
assert(orderBuilder.reportValidityCalls > 0, 'WhatsApp Order Builder actions call reportValidity before continuing');
assert(orderBuilder.previewed && orderBuilder.previewFocused && orderBuilder.messagePreview === orderBuilder.preparedMessage && orderBuilder.decodedMessage === orderBuilder.preparedMessage, 'Order preview receives focus and shows the exact decoded WhatsApp message');
assert(orderBuilder.preparedData.subtotalCents === 24998 && orderBuilder.preparedData.deliveryFeeCents === 3500 && orderBuilder.preparedData.totalCents === 28498 && orderBuilder.previewText.includes('R249.98') && orderBuilder.previewText.includes('R35.00') && orderBuilder.previewText.includes('R284.98') && orderBuilder.preparedMessage.includes('Subtotal: R249.98') && orderBuilder.preparedMessage.includes('Delivery fee: R35.00') && orderBuilder.preparedMessage.includes('Requested total: R284.98'), 'Order form, preview and WhatsApp message use matching itemized totals');
assert(/^https:\/\/wa\.me\/27843252262\?text=/.test(orderBuilder.preparedUrl) && orderBuilder.preparedUrl.endsWith(encodeURIComponent(orderBuilder.preparedMessage)) && !orderBuilder.preparedMessage.includes(orderBuilder.preparedData.destinationNumber), 'WhatsApp URL uses the normalized number and correctly encoded message without repeating the destination number');
assert(/This is an order request/i.test(orderBuilder.preparedMessage) && /confirm availability, pricing, fulfilment details and acceptance/i.test(orderBuilder.preparedMessage) && /requested total may require confirmation/i.test(orderBuilder.preparedMessage) && /No payment has been made/i.test(orderBuilder.preparedMessage) && /No stock is reserved/i.test(orderBuilder.preparedMessage) && /does not prove the message was sent or received/i.test(orderBuilder.preparedMessage) && !orderBuilder.prohibitedClaims, 'Prepared message requests confirmation, states the request and payment limits, and makes no completion claim');
assert(orderBuilder.copiedResult === orderBuilder.preparedMessage && orderBuilder.copiedMessage === orderBuilder.preparedMessage, 'Clipboard copy uses exactly the same message as WhatsApp');
assert(orderBuilder.fallbackCopyResult === orderBuilder.preparedMessage && orderBuilder.fallbackText === orderBuilder.preparedMessage && !orderBuilder.failedCopyResult && /could not be copied automatically/i.test(orderBuilder.failedCopyMessage), 'Clipboard denial uses a safe exact-message fallback and reports complete copy failure clearly');
assert(orderBuilder.openedUrl === orderBuilder.preparedUrl && orderBuilder.openCalls.length === 1 && orderBuilder.openCalls[0].url === orderBuilder.preparedUrl && orderBuilder.openCalls[0].target === '_blank' && orderBuilder.openedOpener === null, 'A valid request opens exactly one wa.me context and immediately severs its opener');
assert(orderBuilder.openUiMessage === 'WhatsApp opened with your prepared order request. Review it before sending.', 'WhatsApp action reports only that the prepared request was opened for review');
assert(orderBuilder.safePreview && orderBuilder.safePreviewText.includes('<img src=x onerror=alert(1)>') && orderBuilder.safePreviewText.includes('<script>alert(1)</script>') && !orderBuilder.unsafePreviewNodes, 'HTML-like order input remains harmless visible text in preview');
assert(!orderBuilder.cancelledReset && orderBuilder.cancelledResetPreserved && orderBuilder.confirmedReset, 'WhatsApp Order Builder reset requires confirmation and preserves data when cancelled');
assert(orderBuilder.resetState.businessName === '' && orderBuilder.resetState.destinationNumber === '' && orderBuilder.resetState.customerName === '' && orderBuilder.resetState.rowCount === 1 && orderBuilder.resetState.description === '' && orderBuilder.resetState.quantity === '1' && orderBuilder.resetState.collectionChecked && orderBuilder.resetState.deliveryHidden && orderBuilder.resetState.deliveryAddressDisabled && orderBuilder.resetState.deliveryFeeDisabled && orderBuilder.resetState.deliveryFee === '0.00' && orderBuilder.resetState.previewHidden && orderBuilder.resetState.focused === 'business-name' && orderBuilder.resetState.hasOrderDate && orderBuilder.resetState.hasRequestedDate && /^ORD-\d{4}-001$/.test(orderBuilder.resetState.number), 'Confirmed Order Builder reset restores one blank item, request defaults, empty preview and first-field focus');

await send('Page.close').catch(() => {});
socket.close();

console.log(JSON.stringify({ checks: checks.length, failures, resourceHub, invoice, quote, jobCard, orderBuilder }, null, 2));
if (failures.length) process.exitCode = 1;
