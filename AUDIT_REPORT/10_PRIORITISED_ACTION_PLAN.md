# 10 — Prioritised Action Plan & Final Review

## 10.1 Owner-only checks (no code, do first)

| # | Check | Where | Time |
|---|---|---|---|
| 1 | Which GA4 property and measurement ID is correct? Is data arriving? | GA4 → Admin → Data streams; Realtime | 10 min |
| 2 | Apps Script deployment = Execute as Me, Anyone; latest version deployed | Apps Script → Deploy → Manage deployments | 5 min |
| 3 | Script properties: `ENVIRONMENT=production`, `SPREADSHEET_ID`, `OWNER_EMAIL` = intended inbox | Project settings | 5 min |
| 4 | One labelled controlled enquiry ("TEST ENQUIRY — DELETE"), then delete the row | Live site | 10 min |
| 5 | Leads Sheet sharing is restricted (not "anyone with link") | Google Sheets → Share | 2 min |
| 6 | View the live `contact.html` source: endpoint and `?v=lead-progress` match the repo | Browser | 2 min |
| 7 | Search Console: coverage, Core Web Vitals, any manual actions | GSC | 10 min |
| 8 | GitHub Pages source branch = `main` | Repo Settings → Pages | 2 min |

## 10.2 Seven-day plan (after approval)

| Day | Items | IDs |
|---|---|---|
| 1 | Fix GA ID consistency + test; add CI workflow (`npm test` + check-seo) | P0-2, P1-8 |
| 1 | Remove CV files from the public site | P1-3 |
| 2 | UI/a11y fixes: 404 buttons, hero overlap, link contrast, kicker contrast, Escape closes menu, WhatsApp SVG icon and landmark | P1-7 |
| 3 | Hero rewrite and value proposition (copy only) | P1-4 |
| 3 | `generate_lead` event on confirmed enquiry | P1-10 |
| 4 | Consent checkbox (client + server + tests); privacy notice additions | P1-2 |
| 5 | README rewrite; docs reconciliation; park the Netlify payments code | P2-2 |
| 6–7 | Turnstile + global rate cap + owner-first notification order; controlled live test | P1-1 |

## 10.3 Thirty-day plan

| Week | Items |
|---|---|
| 2 | Packages and pricing page + Care Plan (P1-6); collect testimonials (P1-5) |
| 3 | `web-design-paarl.html` and `whatsapp-ordering.html` landing pages; Google Business Profile + `sameAs` (P1-9) |
| 3 | Tool pages: "Get this branded" CTA, `SoftwareApplication` schema, SRI, lazy jsPDF (P2-7, P2-4) |
| 4 | Build-time partials + central config (P2-1, P2-11); Playwright smoke test in CI (P2-13); Apps Script heartbeat (P2-14) |
| 4 | Case study: "How our enquiry system works", plus Work page reordering (P1-5) |

## 10.4 Scores recap

UI/UX 7 · Mobile 7 · Frontend engineering 7 · Performance 9 · SEO 7 · Accessibility 7 · Security 6 · Conversion 4 · Maintainability 5 · Business positioning 4. Evidence is in 00 §3 and each section.

---

## 10.5 Final review

### 1. What is already working well and should not be touched?
- The **enquiry controller and Apps Script logic**: validation, idempotency, success only on a trusted reference, injection guards, test-mode gate, 42 tests. Extend it; do not rewrite it.
- **Performance architecture**: static HTML, deferred JS, WebP with dimensions. Local Lighthouse 99–100.
- **SEO infrastructure**: canonicals, JSON-LD graph, sitemap, robots, noindex choices, branded 404, `check-seo.mjs`.
- **Visual identity**: navy/gold tokens, Manrope + Playfair, layout system.
- **Honest labelling** of concepts, prototypes and disabled payments.
- **The four browser tools** and the Resource Hub.
- **Framework-free architecture.**

### 2. What is broken or unreliable?
- **Verified broken:** 404 button contrast (1.5:1); desktop hero card overlapping caption text; Escape does not close the mobile menu; GA4 ID inconsistent between code and privacy page/docs/tests; tests that pass despite that inconsistency; README describes a different site.
- **Unreliable / unverified:** production enquiry delivery (last documented state: sign-in redirect); whether GA data reaches the intended property; email-quota exposure to abuse; live/repo parity.

### 3. What is technically holding the website back?
- Hand-duplicated layout across 11+ pages, which makes every structural change slow and error-prone. This blocks adding pricing and landing pages cheaply.
- No CI, so quality depends on memory.
- Contact details and config hard-coded in about 60 places.
- The Apps Script iframe/postMessage protocol is fragile, and there is no production monitoring.
- Stale and contradictory documentation, which misleads future (including AI-assisted) changes.

### 4. What is preventing better customer conversion?
- No proof: testimonials, real client work, results.
- No price anchors or packages.
- Abstract hero copy that doesn't say what, for whom or where.
- Generalist "four disciplines" positioning, with "AI" claimed but unproven.
- Free tools with no upsell path.
- The primary conversion (form success) is not measured, so nothing can be optimised.

### 5. What can realistically be improved within seven days?
GA ID fix, CI, CV removal, all listed UI/a11y defects, hero rewrite, `generate_lead` tracking, consent checkbox plus privacy additions, README and docs cleanup, and endpoint hardening (Turnstile + global cap). See §10.2. All are small, low-risk and need no new architecture.

### 6. What should be improved within 30 days?
Packages and pricing page with a Care Plan; testimonials and a case study; 2–4 service/location landing pages; Google Business Profile; tool-page upsells; build-time partials + central config; Playwright/axe CI; Apps Script heartbeat.

### 7. What should wait until the business generates more revenue?
A custom backend and database; client portal; online payments; multi-tenant SaaS tools; WhatsApp Cloud API; AI chat features; a blog content programme at scale; a move to a header-capable host for CSP.

### 8. What should eventually become a backend-powered feature?
- **Enquiries/CRM** (Sheets → Django/Flask/Express + Postgres, with admin, statuses and follow-ups).
- **Quote → invoice → payment** workflow with persisted documents and PayFast/PayPal server verification (the parked Netlify code is the starting point).
- **Branded tools for clients** (accounts, saved templates, logos, numbering).
- **Booking/scheduling.**
- **Notifications** (transactional email provider + WhatsApp Business API).
- **Client portal** (project status, files, invoices).

---

**Awaiting explicit approval before making any production changes.** No production file has been modified; the only new content is this `AUDIT_REPORT/` folder (uncommitted).
