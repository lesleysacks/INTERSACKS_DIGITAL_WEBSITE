# InterSacks Digital SEO report

Audited 2 November 2026 (Johannesburg). Source repository: `lesleysacks/INTERSACKS_DIGITAL_WEBSITE`, branch `main`, commit `c2386a4` (1 September 2026, 20:25 SAST). This work is on development branch `cursor/seo-optimisation-8584`. It has not been deployed to https://www.intersacks.co.za.

No search volumes or ranking positions are stated. No Google account was available, so Search Console, Analytics, and Business Profile could not be connected. No street address, opening hours, reviews, awards, or prices were added, because the site does not publish them.

## 1. Initial health

The live site is a static HTML site on GitHub Pages. On 2 November 2026 the checks were:

- `https://www.intersacks.co.za/` returned HTTP 200 over HTTPS, with HSTS.
- `http://www.intersacks.co.za/` and `https://intersacks.co.za/` redirected with HTTP 301 to `https://www.intersacks.co.za/`.
- `https://www.intersacks.co.za/index.html` also returned HTTP 200, so the homepage has two URLs.
- `robots.txt` and `sitemap.xml` returned the host's default 404.
- Unknown URLs returned that same default 404, not a branded page.
- The homepage had a title and description, but no canonical URL. Open Graph image was a relative path.
- About, services, work, process, contact, and resources each had one title and one description. They had no canonical URL, no Open Graph URL, and no structured data.
- There is one H1 on each primary page. Project images already have alt text, width, and height. The portfolio WebP files are about 16–55 KB.

The pages that exist are Home, About, Services, Work, Resources, Process, Contact, an unlinked payments notice, four browser tools, and two greeting-card templates.

## 2. Technical issues found

| Issue | What was done |
|---|---|
| No sitemap | `sitemap.xml` lists 11 indexable URLs on `https://www.intersacks.co.za` |
| No robots.txt | `robots.txt` allows crawling and points at the sitemap |
| No canonical URLs | Primary pages and the four tools now canonicalise to the www domain. The homepage canonical is `https://www.intersacks.co.za/` |
| Homepage also available as `/index.html` | Canonical points at the root. GitHub Pages cannot redirect one static file to the other without a host rule, so both URLs still respond |
| Default 404 | `404.html` explains the miss and links home, services, and contact. It is `noindex` |
| Payments notice could be indexed | `payments.html` is `noindex` and is not in the sitemap. Online payments remain unavailable |
| Greeting-card templates could compete with the agency pages | Both templates are `noindex` |
| Social tags were incomplete or relative | Open Graph and Twitter tags use absolute `www` URLs. The share image is the existing business card, 1080×716, not a generated 1200×630 graphic |
| No structured data | Organization, website, page, breadcrumb, and service markup were added from visible details only |
| Enquiry path | Unchanged. See section 11 |

`scripts/check-seo.mjs` checks unique titles and descriptions, canonical host, one H1, parseable JSON-LD, image alt attributes, the sitemap, and the existing enquiry recipient.

## 3. Keyword research and intent

These terms were checked against the services the site already lists: business websites, landing pages, e-commerce, branding, CRM and booking systems, workflow automation, AI solutions, custom software, and integrations. The studio is based in Paarl, Western Cape. It does not publish a wider service-area list.

No keyword tool was connected, so there are no search volumes.

| Page | Primary intent | Supporting terms | Competition observed on 2 Nov 2026 |
|---|---|---|---|
| Home | A Paarl business looking for a website and practical automation | website design Paarl, business automation, small-business website | “Website design Paarl” already has dedicated local pages, including Nifty Studio, WebBuild, Paarl Web Design, and NextWave Sites |
| Services | Compare what the studio actually offers | business websites, landing pages, e-commerce, branding, workflow automation, practical software | Local studios publish package and price pages. InterSacks does not publish prices |
| Contact | Request a quote | Paarl web designer contact, WhatsApp enquiry | Transactional. The form, phone, email, and WhatsApp button already exist |
| Work | Proof before an enquiry | portfolio, live website, concept demo | Supporting page, not a keyword target of its own |
| Process | Understand how a project runs | website project process | Informational support for the quote |
| About | Confirm who runs the studio | Lesley Sacks, Paarl | Trust page. The founder is named on this page only |

“Website design South Africa” and “affordable website design” are broader than the evidence on the site. The copy says the studio is based in Paarl. It does not say “cheapest” or publish a national price. Those phrases were not forced into titles.

“WhatsApp business automation” is a real search, but the site uses WhatsApp as a contact channel and ships a browser order-request tool. It does not advertise a WhatsApp Business API product. That phrase was not added as a service.

“Website maintenance” is not an advertised service. The process page says the studio launches the work and leaves a platform for what comes next. No maintenance page was created.

## 4. Page-by-page recommendations and titles

Recommended titles below are the ones now in the files.

| Page | Title | Meta description focus |
|---|---|---|
| Home | Websites and Automation in Paarl \| InterSacks Digital | Websites, branding, and practical automation. Based in Paarl. Request a quote |
| Services | Website Design and Automation \| InterSacks Digital | The four current services and a project quote |
| Work | Website and Automation Work \| InterSacks Digital | Live sites, labelled concept demos, and browser tools |
| About | About InterSacks Digital \| Paarl Studio | South African studio in Paarl, led by Lesley Sacks |
| Process | How a Website Project Works \| InterSacks Digital | Conversation, plan, build, and launch |
| Contact | Request a Quote \| InterSacks Digital | Quote, phone 084 325 2262, WhatsApp |
| Resources | Resource Hub \| InterSacks Digital | Existing description kept. It already matches the hub |

Visible H1 lines were kept. They are part of the current brand voice. Search detail was added in titles, descriptions, and short supporting sentences.

Separate URLs for “website design”, “automation”, “AI”, “digital solutions”, and “maintenance” were not added. The services page already has those four offers, with anchors:

- `services.html#web-solutions`
- `services.html#branding`
- `services.html#business-automation`
- `services.html#ai-software`

New URLs would repeat that page. They can be split later if Search Console shows a distinct query that this page does not answer.

## 5. Changes implemented

- Unique titles, descriptions, canonical links, robots directives, Open Graph, and Twitter metadata.
- `robots.txt`, `sitemap.xml`, and `404.html`.
- JSON-LD for the business, website, pages, breadcrumbs, and the four services.
- Visible breadcrumbs that match the breadcrumb markup.
- Service copy that names the existing offers and says a quote depends on scope. No price was invented.
- AI copy states that the work is scoped and that unfinished work is marked on the work page.
- Homepage closing action now goes to the contact form and shows the published phone number. The form still builds the same email.
- Internal links between services, work, process, about, and contact.
- Payments page and greeting-card templates set to `noindex`.
- Tool pages received canonical and social tags. The WhatsApp Order Builder does not use a `twitter:card` meta name, because the existing test treats any control name containing “card” as a checkout field.

The enquiry handler in `js/script.js` still opens `mailto:lesleysacks1@gmail.com` with the same subject and body fields. No Apps Script URL, spreadsheet, or recipient was changed. This repository does not contain a Google Sheets enquiry endpoint.

## 6. Structured data

Markup was parsed with `node scripts/check-seo.mjs`. It confirms the JSON parses, and that the graph does not include a street address, postal code, opening hours, rating, review count, or award.

The business node uses only details printed on the site:

- Name: InterSacks Digital
- URL: https://www.intersacks.co.za/
- Email: lesleysacks1@gmail.com
- Telephone: +27843252262
- Locality: Paarl, Western Cape, South Africa

Lesley Sacks is marked as founder only on the About page, where that name is visible. The four services match the services page. Breadcrumb markup matches the visible breadcrumb.

This was not submitted to Google's Rich Results Test. That test needs the public URL after deployment.

## 7. Performance

Local Lighthouse 12.8.2 lab run, homepage only, at http://127.0.0.1:43123/index.html. Fetched 2 November 2026, 18:28 Johannesburg. This is not field data from Chrome User Experience Report, and it is not a measurement of the live site.

| Check | Result |
|---|---|
| Performance | 93 |
| Accessibility | 95 |
| SEO | 100 |
| First Contentful Paint | 2.6 s |
| Largest Contentful Paint | 2.7 s |
| Speed Index | 2.6 s |
| Total Blocking Time | 0 ms |
| Cumulative Layout Shift | 0 |
| Interaction to Next Paint | Not in this lab run. It is a field metric |

The render-blocking font stylesheet was estimated at about 1.7 s of savings. The branded homepage loader also holds the first view for about one second, with a 2.5 second safety release. Existing tests lock that loader, so it was not shortened.

Two accessibility notes were already on the page before this work: the decorative “iS” watermark has low contrast, and the logo link’s accessible name does not repeat the visible wordmark. They were left in place so the header and artwork stay as they are.

Portfolio WebP images are about 16–55 KB, with width, height, and alt text. The founder portrait is about 43 KB. The business-card JPEG used for sharing is 72 KB and 1080×716. Fonts already request `display=swap`. Browser checks: 951 passed, including layout at 320, 375, 768, 1024, and 1440 px.

## 8. Local SEO

Used, because it is already on the site: “Paarl”, “Western Cape”, and “South Africa” in the footer and contact details, plus the phone and email.

Added only as a restatement: Paarl in the homepage and services titles, and in the services introduction.

Not added:

- A street address, map pin, or opening hours.
- A claim that the studio serves Cape Town, Stellenbosch, Wellington, or the whole country as a defined service area.
- Reviews, ratings, or directory listings.

Google Business Profile, when you are ready: create or claim the profile as InterSacks Digital, category aligned to website design, with the website, the published phone, and Paarl, Western Cape. Leave the street address blank unless you decide to publish one. Do not ask customers to review the business until real projects are complete.

Directory listings can wait for the same decision. A listing with a guessed address would conflict with the site.

## 9. Content roadmap

Do not publish these until the factual gaps below are filled. No articles were added in this change.

1. Why a small business needs a proper website. Safe to draft from the services already offered. Avoid claiming ranking results.
2. What a business website costs in South Africa. Do not publish until InterSacks has its own quote ranges. On 2 November 2026 other studios published conflicting prices, from about R1,499 and R3,000 at the low end to R18,000–R45,000 for Paarl packages. Those are their prices, not InterSacks prices, and they are too far apart to summarise as one market rate.
3. Five business tasks worth automating. Limit the examples to CRM, bookings, and workflow follow-up, which are the listed automation services.
4. How a WhatsApp enquiry is handled. Explain the current WhatsApp button and the order-request tool. Do not describe a WhatsApp API product the site does not sell.
5. How AI can save admin time. Keep it to scoped software and integrations. Point at the work page for anything still in development.
6. Website design compared with website builders. Useful only if it stays practical and does not invent client results.
7. How a website can turn a visit into an enquiry. The contact form, phone, and WhatsApp button are the real examples.
8. What a proper online presence includes. Website, consistent brand, and a way to respond. Maintenance can be mentioned only after you decide to offer it.

Publish one page at a time, then inspect it in Search Console before writing the next.

## 10. Conversion

A visitor can already see the four services, the work, the process, and the contact choices. The homepage's last button previously opened a blank email. It now opens the contact form, which still prepares that same email, and the phone number is beside it. Each service has a quote link. The services introduction says pricing is quoted per project.

Left alone on purpose: form field names, the mailto recipient, the WhatsApp number, the payment functions, and the “payments temporarily unavailable” message.

## 11. Outstanding

- Deploy this branch only after you approve it. The live site is unchanged.
- `/` and `/index.html` both return 200 until the host can redirect the duplicate.
- Search Console, Analytics, Tag Manager, and Business Profile are not connected. There is no measurement ID in the repository, so no tracking script was added.
- The enquiry is a mailto handoff, not a Google Sheet. Nothing in this repository posts the form to an Apps Script. If a Sheet workflow exists outside the repo, it was not part of this site and was not modified.
- No maintenance offer, no published prices, no street address, and no reviews.
- The share image is 1080×716. A 1200×630 image can be designed later from the real brand, not generated as a fake screenshot.
- `README.md` still describes an older React-style site. It was left unchanged so this commit stays on the SEO work.
- The CV files already in `assets/` were not added to the sitemap and were not removed.
- Rich Results Test and Lighthouse on the public URL can run after deployment.

## 12. Search Console setup

1. Open Google Search Console and add a URL-prefix property for `https://www.intersacks.co.za/`.
2. Verify it with the HTML file or DNS method Google shows you. Put that file in the site root when you deploy. Do not invent a verification token in the repo beforehand.
3. Submit `https://www.intersacks.co.za/sitemap.xml`.
4. Use URL Inspection on the homepage, services page, and contact page, and request indexing after the new HTML is live.
5. Each month, export Performance for queries, pages, countries, and devices. Compare the last 28 days with the previous 28 days. Watch impressions for “Paarl” and “website” queries, and the landing page that receives them.
6. Enquiry conversions will not appear in Search Console. The form opens the visitor's email app. Analytics can count that click only after you add a measurement ID. Use one GA4 tag or Tag Manager, not both.

## 13. 90-day plan

This is a sequence, not a ranking promise.

- Days 1–14: approve and deploy this branch. Verify Search Console. Submit the sitemap. Inspect the homepage, services, and contact URLs.
- Days 15–45: read the first query report. If “website design Paarl” appears, keep strengthening `services.html#web-solutions` before creating a new URL. Claim the Business Profile only with the published phone, website, and Paarl location.
- Days 46–90: publish the first article whose facts you have approved. Re-check titles, index coverage, and whether contact visits moved. Decide then whether maintenance, a price guide, or a separate automation URL is justified.

## Scorecard

| Item | Status |
|---|---|
| Technical indexability: titles, descriptions, canonicals, sitemap, robots, 404 | Completed |
| Structured data from visible business details | Completed |
| On-page copy for the four existing services | Completed |
| Local wording for Paarl, without a new address | Completed |
| Enquiry form and mailto recipient preserved | Completed |
| Content articles | Not completed. Roadmap only, pending facts and approval |
| Dedicated maintenance, WhatsApp-automation, or price pages | Not completed. The site does not currently offer them as stated products |
| Google Search Console, Analytics, Tag Manager | Requires external account access |
| Google Business Profile and directories | Requires business approval and the same public contact details |
| Deployment to www.intersacks.co.za | Requires business approval |
| Lighthouse on the public site and Rich Results Test | Partially completed. One local homepage lab run is recorded above. The public URL has not been measured |
