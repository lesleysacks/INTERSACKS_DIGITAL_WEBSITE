const baseUrl = process.env.SITE_URL || 'http://127.0.0.1:4315';
const devtoolsUrl = process.env.DEVTOOLS_URL || 'http://127.0.0.1:9235';
const failures = [];
const fail = (message) => failures.push(message);

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
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (!message.id) return;
  const handler = pending.get(message.id);
  if (!handler) return;
  pending.delete(message.id);
  if (message.error) handler.reject(new Error(message.error.message));
  else handler.resolve(message.result);
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = nextId++;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
});
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Browser evaluation failed');
  return result.result.value;
};

await send('Page.enable');
await send('Network.enable');
const requests = [];
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.method === 'Network.requestWillBeSent') requests.push(message.params.request.url);
});

const goto = async (path) => {
  requests.length = 0;
  await send('Page.navigate', { url: `${baseUrl}/${path}` });
  await send('Page.loadEventFired').catch(() => {});
  await sleep(400);
};

const events = () => evaluate(`(() => (window.dataLayer || []).filter((item) => item && item[0] === 'event').map((item) => ({ name: item[1], params: { page_path: item[2] && item[2].page_path, link_location: item[2] && item[2].link_location, service_name: item[2] && item[2].service_name } })))()`);

const click = (selector) => evaluate(`(() => { const link = document.querySelector(${JSON.stringify(selector)}); if (!link) return false; link.click(); return true; })()`);

await goto('index.html');
const home = await evaluate(`(() => ({ scripts: document.querySelectorAll('script[src="js/analytics.js"]').length, id: ${JSON.stringify('G-Q85HJEHCZ7')} }))()`);
if (home.scripts !== 1) fail(`Homepage loads analytics ${home.scripts} times`);
if (requests.some((url) => url.includes('googletagmanager.com'))) fail('Local homepage requested the production Google tag');

const quoteClicked = await click('section.contact a.button.button-gold[href="contact.html"]');
if (!quoteClicked) fail('Homepage quote link was not found');
let homeEvents = await events();
const quotes = homeEvents.filter((event) => event.name === 'quote_request_click');
if (quotes.length !== 1) fail(`Homepage quote click sent ${quotes.length} events`);
if (quotes[0] && (quotes[0].params.link_location !== 'contact' || !quotes[0].params.page_path.endsWith('/index.html') && quotes[0].params.page_path !== '/')) {
  fail(`Homepage quote parameters were ${JSON.stringify(quotes[0])}`);
}
await click('a[href^="tel:"]');
homeEvents = await events();
if (homeEvents.filter((event) => event.name === 'phone_click').length !== 1) fail('Homepage phone click did not send one event');
await click('a.whatsapp-button');
homeEvents = await events();
if (homeEvents.filter((event) => event.name === 'whatsapp_click').length !== 1) fail('Homepage WhatsApp click did not send one event');
if (homeEvents.some((event) => event.name === 'page_view')) fail('Custom tracking also sent page_view');

await goto('services.html');
for (const id of ['web-solutions', 'branding', 'business-automation', 'ai-software']) {
  await evaluate(`(() => { const section = document.getElementById(${JSON.stringify(id)}); (section.querySelector('h2') || section).scrollIntoView({ block: 'center', behavior: 'instant' }); return true; })()`);
  await sleep(200);
}
await evaluate(`(() => { const section = document.getElementById('web-solutions'); (section.querySelector('h2') || section).scrollIntoView({ block: 'center', behavior: 'instant' }); return true; })()`);
await sleep(200);
const serviceEvents = await events();
const views = serviceEvents.filter((event) => event.name === 'service_view').map((event) => event.params.service_name);
const expected = ['Web Solutions', 'Branding', 'Business Automation', 'AI and Software'];
if (expected.some((name) => views.filter((value) => value === name).length !== 1)) fail(`Service views were ${JSON.stringify(views)}`);
await click('#web-solutions a.service-enquiry');
const serviceClicks = await events();
const serviceQuote = serviceClicks.filter((event) => event.name === 'quote_request_click');
if (serviceQuote.length !== 1 || serviceQuote[0].params.service_name !== 'Web Solutions' || serviceQuote[0].params.link_location !== 'service') {
  fail(`Service quote event was ${JSON.stringify(serviceQuote)}`);
}

await goto('contact.html');
let contactEvents = await events();
if (contactEvents.filter((event) => event.name === 'contact_page_view').length !== 1) fail('Contact page view did not fire once');
await click('a[href^="mailto:"]');
await click('a[href^="mailto:"]');
await click('a[href^="tel:"]');
await click('a.contact-whatsapp');
contactEvents = await events();
if (contactEvents.filter((event) => event.name === 'email_click').length !== 2) fail('Repeated email clicks were not counted once each');
if (contactEvents.filter((event) => event.name === 'phone_click').length !== 1) fail('Contact phone click was not counted once');
if (contactEvents.filter((event) => event.name === 'whatsapp_click').length !== 1) fail('Contact WhatsApp link was not counted once');
const leaked = JSON.stringify(contactEvents);
if (leaked.includes('@') || leaked.includes('084') || leaked.includes('27843252262')) fail('Analytics parameters included contact details');

await goto('work.html');
await evaluate(`(() => { const link = [...document.querySelectorAll('a')].find((item) => /request a quote/i.test(item.textContent || '')); if (!link) return false; link.click(); return true; })()`);
const workQuotes = (await events()).filter((event) => event.name === 'quote_request_click');
if (workQuotes.length !== 1 || workQuotes[0].params.link_location !== 'hero') fail(`Work quote event was ${JSON.stringify(workQuotes)}`);

await goto('process.html');
await evaluate(`(() => { const link = [...document.querySelectorAll('a')].find((item) => /quote request/i.test(item.textContent || '')); if (!link) return false; link.click(); return true; })()`);
const processQuotes = (await events()).filter((event) => event.name === 'quote_request_click');
if (processQuotes.length !== 1 || processQuotes[0].params.link_location !== 'page') fail(`Process quote event was ${JSON.stringify(processQuotes)}`);

const pages = ['about.html', 'work.html', 'process.html', 'resources.html', 'assets/invoice_generator.html', 'assets/quote_generator.html', 'assets/job_card_generator.html', 'assets/whatsapp_order_builder.html'];
for (const page of pages) {
  await goto(page);
  const src = page.startsWith('assets/') ? '../js/analytics.js' : 'js/analytics.js';
  const count = await evaluate(`document.querySelectorAll(${JSON.stringify(`script[src="${src}"]`)}).length`);
  if (count !== 1) fail(`${page} loaded analytics ${count} times`);
  if (requests.some((url) => url.includes('googletagmanager.com'))) fail(`${page} requested the production Google tag locally`);
}
for (const page of ['payments.html', '404.html']) {
  await goto(page);
  const count = await evaluate('document.querySelectorAll(\'script[src*="analytics.js"]\').length');
  if (count !== 0) fail(`${page} should not load analytics`);
}

socket.close();
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('Analytics checks passed. Local pages did not request the production Google tag.');
