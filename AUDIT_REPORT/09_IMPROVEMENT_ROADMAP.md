# 09 — Improvement Roadmap (Phase 11)

Complexity: **XS** (<1 h) · **S** (½ day) · **M** (1–3 days) · **L** (1–2 weeks).
**Essential** = fixes a defect, a risk or a major conversion blocker. **Optional** = an enhancement.
Nothing here has been implemented.

---

## P0 — Critical

### P0-1 Verify the production enquiry pipeline  *(Essential)*
1. **Problem:** it is unknown whether website enquiries are saved and notified.
2. **Evidence:** `docs/enquiry-system.md`: on 11 Nov 2026 the `/exec` URL redirected anonymous users to Google sign-in. The deployed access and script properties are not in the repo. The live site could not be reached from this audit environment.
3. **Business impact:** if broken, **every form lead is lost** and the visitor sees an error.
4. **Technical impact:** none on the code. This is a configuration check.
5. **Solution:** owner, in Google: deployment *Execute as Me / Anyone*; properties `ENVIRONMENT=production`, `SPREADSHEET_ID`, `OWNER_EMAIL` (confirm it is the intended notification address); run `runSafeSelfTest()`; then **one** clearly labelled controlled enquiry (as in docs §Safe verification). Confirm the row, `ISD-` reference and both emails. View the live `contact.html` source to confirm the endpoint matches the repo.
6. **Files:** none (possibly `contact.html` if the `/exec` URL changed).
7. **Complexity:** XS.
8. **Dependencies:** owner's Google account.
9. **Testing:** the controlled enquiry; `npm test` if any file changes.

### P0-2 Resolve the GA4 measurement-ID mismatch  *(Essential)*
1. **Problem:** the code sends to `G-XCN1MN0GHR`. The privacy page, docs and checks state `G-Q85HJEHCZ7`.
2. **Evidence:** `js/analytics.js:2` vs `privacy.html:54`, `docs/analytics.md:3`, `scripts/check-seo.mjs:124`, `scripts/check-analytics.mjs:60,138`. Commit `76309a9` changed only `analytics.js`.
3. **Business impact:** either reporting goes to the wrong or an empty property (no marketing data), or the public disclosure is inaccurate.
4. **Technical impact:** tests give false assurance.
5. **Solution:** owner confirms the correct ID in GA4 (Admin → Data streams). Make all five locations agree. Add a test asserting equality.
6. **Files:** `js/analytics.js` *or* `privacy.html`, `docs/analytics.md`, `scripts/check-seo.mjs`, `scripts/check-analytics.mjs`.
7. **Complexity:** XS.
8. **Dependencies:** GA4 access.
9. **Testing:** `check-seo.mjs`, new consistency test, GA4 Realtime / DebugView after deploy.

---

## P1 — High

### P1-1 Harden the enquiry endpoint against email abuse  *(Essential)*
1. **Problem:** a public endpoint sends emails to any supplied address. The rate limit is per email only, and there is no CAPTCHA.
2. **Evidence:** `EnquiryWebApp.gs` `sendCustomerAcknowledgement`, `withinRateLimit_(email)`, honeypot only.
3. **Business impact:** MailApp quota exhaustion → missed owner notifications. Gmail reputation risk.
4. **Technical impact:** small additions to `.gs` and the form.
5. **Solution:** Cloudflare Turnstile (free) verified server-side; a global hourly cap that skips customer email above it; owner email first; a daily failure digest.
6. **Files:** `apps-script/EnquiryWebApp.gs`, `contact.html`, `js/enquiry-form.js`, `tests/enquiry/*`, `docs/enquiry-system.md`, `privacy.html` (Turnstile disclosure).
7. **Complexity:** S–M.
8. **Dependencies:** Turnstile site and secret keys (secret in Script Properties); Apps Script redeploy.
9. **Testing:** new mocked tests (missing or invalid token, global cap); a controlled live test.

### P1-2 POPIA: consent capture and privacy notice completion  *(Essential)*
1. **Problem:** "Consent to contact" is hard-coded "Yes". The notice lacks retention, rights, responsible party and lawful basis.
2. **Evidence:** `saveEnquiry` row value `'Yes'`. `privacy.html`. `docs/analytics.md` acknowledges the lawful-basis gap. `check-seo.mjs:136` forbids the wording.
3. **Business impact:** regulatory and reputational exposure; weaker trust.
4. **Technical impact:** a form field, a server check, a test rule change.
5. **Solution:** a required checkbox "I agree to be contacted about this enquiry (see Privacy)". The server stores its actual value and rejects if absent. Add "Your enquiry data" and "Your rights" sections. Consider GA4 Consent Mode v2 with a real toggle. Relax the forbidden-phrase rule. Get the legal text reviewed.
6. **Files:** `contact.html`, `js/enquiry-form.js`, `EnquiryWebApp.gs`, `privacy.html`, `scripts/check-seo.mjs`, tests.
7. **Complexity:** S (M with a consent banner).
8. **Dependencies:** owner decision on the analytics consent model.
9. **Testing:** unit tests for the missing-consent rejection; check-seo; manual form check.

### P1-3 Remove the personal CV from the public site  *(Essential)*
1. **Problem:** a personal CV with contact data is publicly downloadable.
2. **Evidence:** `assets/L.S CV 2026.pdf`, `.docx`. Not linked from any page.
3. **Business impact:** privacy and scraping risk. Unprofessional if indexed.
4. **Technical impact:** file deletion. Note that it remains in git history; a history rewrite is optional and a separate decision.
5. **Solution:** remove from `main`. If needed, share privately.
6. **Files:** the two CV files.
7. **Complexity:** XS.
8. **Dependencies:** owner approval.
9. **Testing:** the URL returns 404 after deploy.

### P1-4 Rewrite the homepage hero and value proposition  *(Essential, conversion)*
1. **Problem:** the hero fails the 5-second test (what, for whom, why trust).
2. **Evidence:** H1 "We build. We automate. You grow."; see 02 §2.6.
3. **Business impact:** bounce and low enquiry rate.
4. **Technical impact:** copy only.
5. **Solution:** a specific H1 and subhead (audience, service, location), a proof strip, and a primary CTA plus a WhatsApp secondary CTA. Keep the visual design.
6. **Files:** `index.html` (title and description review too).
7. **Complexity:** XS–S.
8. **Dependencies:** owner sign-off on positioning (07 §7.4).
9. **Testing:** check-seo; visual check at 3 widths.

### P1-5 Add trust signals: testimonials and real client work  *(Essential, conversion)*
1. **Problem:** no social proof; the portfolio is mostly concepts.
2. **Evidence:** Work page labels (02 §2.9); no testimonials anywhere.
3. **Business impact:** the largest conversion barrier for a new studio.
4. **Technical impact:** a new static section and cards.
5. **Solution:** collect 3–5 testimonials (with permission). Make 1–2 short case studies (problem → solution → result), including the InterSacks enquiry system itself. Order Work so that real or paid projects come first. Consider renaming concepts that use real business names, or get permission.
6. **Files:** `index.html`, `work.html`, `css/styles.css`; optional `Review` schema only for genuine first-party reviews.
7. **Complexity:** S (content-dependent).
8. **Dependencies:** client permission.
9. **Testing:** visual and axe.

### P1-6 Packages and "from" pricing page  *(Essential, conversion)*
1. **Problem:** no price anchoring.
2. **Evidence:** Services and Contact pages: "A quote is prepared…".
3. **Business impact:** lost price-shopping SME leads; unqualified enquiries.
4. **Technical impact:** one new static page plus a nav link (×11 files without templating).
5. **Solution:** 3–4 packages plus a Care Plan, with "from R…" prices, inclusions and FAQs. Link from the nav, the services and the contact form ("Which package?" select).
6. **Files:** new `pricing.html`, all page navs, `sitemap.xml`, `check-seo.mjs` page list, `js/script.js` `internalPages`.
7. **Complexity:** S–M.
8. **Dependencies:** owner pricing decisions.
9. **Testing:** check-seo, links, responsive check.

### P1-7 Fix visible UI and accessibility defects  *(Essential)*
- **Problems and evidence:** 404 gold buttons at 1.5:1 contrast (axe). Breadcrumb and inline link contrast failures. Resources 9 px gold kickers at 2.41:1. Desktop hero card overlap (screenshot). Mobile menu ignores Escape. WhatsApp button outside a landmark and shown as a "W" letter. Tap targets under 24 px.
- **Impact:** looks unfinished; WCAG 2.2 AA failures.
- **Solution:** CSS fixes (404 button colours, link underline, kicker colour `--gold-dark`, art-card positioning), Escape handler + focus return, an inline WhatsApp SVG, and wrapping the button in a labelled `<aside>` or moving it inside `<footer>`.
- **Files:** `css/styles.css`, `css/resources.css`, `js/script.js`, all pages (WhatsApp markup).
- **Complexity:** S. **Dependencies:** none. **Testing:** axe serious = 0, Lighthouse a11y ≥ 95, screenshots.

### P1-8 Add CI (GitHub Actions)  *(Essential)*
- **Problem:** tests never run automatically. **Evidence:** no `.github/workflows`.
- **Solution:** a workflow running `npm test`, `check-seo.mjs` and the GA consistency test on PRs and `main`; later a Playwright smoke test. No dependencies are needed for the first step (Node built-ins only).
- **Files:** new `.github/workflows/ci.yml`. **Complexity:** XS–S. **Testing:** the workflow passes on the current `main`.

### P1-9 Service and local landing pages  *(Essential for SEO growth)*
- **Problem:** one services page covers four services; there is no location-intent page. **Evidence:** 05 §5.2–5.3.
- **Solution:** `web-design-paarl.html` (lead), `whatsapp-ordering.html`, `website-care-plan.html`, `business-automation.html`. Each with 600–900 words of real content, FAQs, a CTA, `Service` schema and internal links. Create and link a Google Business Profile, and add `sameAs` and `areaServed`.
- **Files:** new pages, navs and footers, `sitemap.xml`, `check-seo.mjs`. **Complexity:** M. **Dependencies:** positioning sign-off, GBP. **Testing:** check-seo, Search Console URL inspection.

### P1-10 Track confirmed form leads in GA4  *(Essential)*
- **Problem:** the main conversion is not measured.
- **Solution:** on a trusted success message, `gtag('event','generate_lead',{service_name, link_location:'contact'})` with no personal data. Mark it as a key event. Update the privacy page.
- **Files:** `js/enquiry-form.js` or `js/analytics.js`, `privacy.html`, `docs/analytics.md`, tests. **Complexity:** XS. **Dependencies:** P0-2.

---

## P2 — Medium

| ID | Recommendation | Evidence | Files | Cx | Essential? |
|---|---|---|---|---|---|
| P2-1 | **Build-time partials** for head, header, footer and WhatsApp (tiny Node script in CI → static output). This is not a framework. | 11× duplicated layout | new `partials/`, `scripts/build.mjs`, Pages via Actions | M | Optional but high-value |
| P2-2 | Rewrite `README.md`; reconcile docs (analytics.md mailto text); mark Netlify payments as parked or remove from `main` | 01 §1.4 | README, docs, netlify/*, PAYMENTS.md, js/payments.js | S | Essential (maintainability) |
| P2-3 | Shorten or remove the homepage loader; make the overlay fail-safe (CSS timeout animation) | 04 | `js/script.js`, `css/styles.css`, `index.html` | S | Optional |
| P2-4 | `srcset`/`sizes` for project images; lazy-load jsPDF; add SRI to the CDN script | 04, 06 S6 | work, index, assets/*.html | S | Optional / SRI essential-lite |
| P2-5 | Consistent `?v=` cache busting on all CSS/JS | only contact uses it | all pages | XS | Optional |
| P2-6 | 1200×630 branded OG images; `og:image:width/height` on all pages | 05 #9 | all pages, new images | S | Optional |
| P2-7 | Tool pages: longer descriptions, `SoftwareApplication` schema, "Get this branded" CTA | 05 #8, 07 #3 | assets/*.html | S | Optional (revenue) |
| P2-8 | Internal links to `/` rather than `index.html` | 05 #6 | all pages | XS | Optional |
| P2-9 | Contact form: optional budget and timeline fields, service-specific WhatsApp prefills, hero "Enquire now" anchor on mobile | 07 | contact.html, gs, tests | S | Optional |
| P2-10 | Remove the unused `valentines-cards.webp`; move the Sheet ID out of public docs; confirm Sheet sharing | 01, 06 S5 | assets, docs | XS | Optional |
| P2-11 | Central config (phone, email, WhatsApp text) generated into pages at build | 03 §3.6 | with P2-1 | S | Optional |
| P2-12 | Merge Process into Services/About; move Resources to the footer as "Free tools" | 02 §2.5 | navs | S | Optional |
| P2-13 | Playwright + axe smoke test in CI; weekly external link check | 08 §8.4 | `.github/`, `tests/` | M | Optional |
| P2-14 | Apps Script production heartbeat and failure digest | 08 §8.4 | gs | S | Essential-lite |

Each P2 item: **Dependencies** — P2-11 depends on P2-1. Others are independent. **Testing** — `npm test`, check-seo, visual check at 375, 768 and 1440, axe.

---

## P3 — Future (wait for revenue or demand)

| ID | Recommendation | Notes |
|---|---|---|
| P3-1 | **Backend for enquiries** (Django or Flask on a small VPS / Render / Railway): `/api/enquiries` with Postgres, admin CRM, status workflow, email via a transactional provider (Brevo, Postmark) | Replaces Sheets when volume or teams grow. The controller needs a `fetch-json` transport (prep in P2). |
| P3-2 | **Client portal**: quotes, invoices and payment status | Builds on the existing tools |
| P3-3 | **Online payments** (PayFast first for SA), invoice-linked, server-verified ITN | Revive the parked Netlify code only with an invoice DB |
| P3-4 | **Multi-tenant branded tools** (quote, invoice, job card) as a paid SaaS or white-label product | Needs auth and storage |
| P3-5 | WhatsApp Business Cloud API notifications (the stub already exists) | Needs Meta business verification |
| P3-6 | Blog or guides hub (SA SME website costs, POPIA for small sites, WhatsApp ordering) | Content effort |
| P3-7 | Self-hosted fonts, a CSP via a host that supports headers (Cloudflare Pages / Netlify) | Defence in depth |
| P3-8 | Booking or calendar integration ("Book a 15-min call") | Google Calendar appointment page is the zero-dev option |
| P3-9 | AI features (chat assistant trained on services/FAQ) | Only after core proof exists |
