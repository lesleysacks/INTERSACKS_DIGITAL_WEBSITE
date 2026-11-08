import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8');
const failures = [];
const fail = (message) => failures.push(message);

const primary = [
  'index.html',
  'about.html',
  'services.html',
  'work.html',
  'process.html',
  'contact.html',
  'resources.html',
  'privacy.html'
];
const tools = [
  'assets/invoice_generator.html',
  'assets/quote_generator.html',
  'assets/job_card_generator.html',
  'assets/whatsapp_order_builder.html'
];
const noindex = [
  'payments.html',
  '404.html',
  'assets/templates/greeting-cards/birthday-card-template.html',
  'assets/templates/greeting-cards/valentine-card-template.html'
];

const titles = new Map();
const descriptions = new Map();

const attr = (html, name) => {
  const match = html.match(new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']*)["']`, 'i'))
    || html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+name=["']${name}["']`, 'i'));
  return match?.[1] || '';
};

const prop = (html, name) => {
  const match = html.match(new RegExp(`<meta[^>]+property=["']${name}["'][^>]+content=["']([^"']*)["']`, 'i'));
  return match?.[1] || '';
};

for (const file of [...primary, ...tools]) {
  const html = read(file);
  const title = (html.match(/<title>([^<]*)<\/title>/i) || [])[1] || '';
  const description = attr(html, 'description');
  const canonical = (html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i) || [])[1] || '';
  const robots = attr(html, 'robots');
  const h1s = html.match(/<h1\b/gi) || [];
  if (!title) fail(`${file} is missing a title`);
  if (titles.has(title)) fail(`${file} repeats the title used by ${titles.get(title)}`);
  titles.set(title, file);
  if (description.length < 70 || description.length > 170) fail(`${file} description length is ${description.length}`);
  if (descriptions.has(description)) fail(`${file} repeats a meta description`);
  descriptions.set(description, file);
  if (!canonical.startsWith('https://www.intersacks.co.za/')) fail(`${file} canonical is not on the www domain`);
  if (file === 'index.html' && canonical !== 'https://www.intersacks.co.za/') fail('Homepage canonical is not the root URL');
  if (!robots.includes('index, follow')) fail(`${file} is not explicitly indexable`);
  if (h1s.length !== 1) fail(`${file} has ${h1s.length} h1 elements`);
  if (!prop(html, 'og:title') || !prop(html, 'og:description') || !prop(html, 'og:url') || !prop(html, 'og:image')) {
    fail(`${file} is missing Open Graph metadata`);
  }
  if (!prop(html, 'og:image').startsWith('https://www.intersacks.co.za/')) fail(`${file} Open Graph image is not absolute`);
  const jsonBlocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)];
  if (primary.includes(file) && jsonBlocks.length !== 1) fail(`${file} should have one JSON-LD block`);
  for (const block of jsonBlocks) {
    try {
      const data = JSON.parse(block[1]);
      const graph = data['@graph'] || [data];
      if (!graph.length) fail(`${file} JSON-LD graph is empty`);
      const text = JSON.stringify(data);
      if (/rating|reviewCount|aggregateRating|award/i.test(text)) fail(`${file} schema includes an unsupported rating or award`);
      if (/streetAddress|postalCode|openingHours/i.test(text)) fail(`${file} schema includes an unpublished address or hours field`);
    } catch (error) {
      fail(`${file} JSON-LD does not parse: ${error.message}`);
    }
  }
  const images = [...html.matchAll(/<img\b[^>]*>/gi)].map((match) => match[0]);
  for (const image of images) {
    if (!/\balt=/.test(image)) fail(`${file} has an image without alt`);
  }
}

for (const file of noindex) {
  const robots = attr(read(file), 'robots');
  if (!robots.includes('noindex')) fail(`${file} should be noindex`);
}

const robots = read('robots.txt');
if (!robots.includes('Sitemap: https://www.intersacks.co.za/sitemap.xml')) fail('robots.txt is missing the sitemap');
if (/Disallow:\s*\/\s*$/m.test(robots)) fail('robots.txt blocks the whole site');

const sitemap = read('sitemap.xml');
const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
if (locs.length !== 12) fail(`sitemap has ${locs.length} URLs`);
if (!locs.includes('https://www.intersacks.co.za/privacy.html')) fail('sitemap is missing the privacy page');
if (locs.some((loc) => loc.includes('payments.html') || loc.includes('404'))) fail('sitemap includes a noindex page');
for (const loc of locs) {
  if (!loc.startsWith('https://www.intersacks.co.za/')) fail(`sitemap URL is off-domain: ${loc}`);
  const relative = loc.replace('https://www.intersacks.co.za/', '') || 'index.html';
  if (!existsSync(join(root, relative))) fail(`sitemap URL has no file: ${relative}`);
}

const enquiry = read('js/script.js');
const enquiryForm = read('js/enquiry-form.js');
const contactPage = read('contact.html');
if (enquiry.includes('mailto:lesleysacks1@gmail.com?subject=')) fail('contact form still builds a mailto enquiry');
if (!enquiryForm.includes('fetchImpl') || !contactPage.includes('name="consent"')) fail('enquiry form is missing the confirmed-save submission');
if (/script\.google|apps script|spreadsheet|1N2xHXT2/i.test(enquiry + enquiryForm + contactPage)) fail('enquiry client contains a private endpoint or spreadsheet id');
if (enquiry.includes('privacy.html')) fail('privacy.html was added to the page-transition list');

const privacy = read('privacy.html');
for (const phrase of [
  'G-Q85HJEHCZ7',
  'Google Analytics 4',
  'whatsapp_click',
  'email_click',
  'phone_click',
  'quote_request_click',
  'service_view',
  'contact_page_view',
  'lesleysacks1@gmail.com',
  'https://policies.google.com/privacy',
  'https://policies.google.com/technologies/cookies'
]) {
  if (!privacy.includes(phrase)) fail(`privacy.html is missing ${phrase}`);
}
if (/lawful basis|we comply|POPIA compliant|cookies are disabled|consent mode/i.test(privacy)) fail('privacy.html states a legal basis or a consent control');
for (const file of ['index.html', 'about.html', 'services.html', 'work.html', 'process.html', 'contact.html', 'resources.html', '404.html', 'payments.html', 'privacy.html']) {
  if (!read(file).includes('href="privacy.html"')) fail(`${file} is missing the privacy link`);
}
for (const file of tools) {
  if (!read(file).includes('href="../privacy.html"')) fail(`${file} is missing the privacy link`);
}
if (!read('assets/quote_generator.html').includes('Your quote information stays in this browser session and is not uploaded by InterSacks Digital.')) fail('quote tool notice changed');
if (!read('assets/job_card_generator.html').includes('Your job card information stays in this browser session and is not uploaded by InterSacks Digital.')) fail('job card tool notice changed');
if (!read('assets/whatsapp_order_builder.html').includes('Order information remains in this browser session')) fail('order tool notice changed');

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(`SEO checks passed for ${primary.length + tools.length} indexable pages and ${locs.length} sitemap URLs.`);
