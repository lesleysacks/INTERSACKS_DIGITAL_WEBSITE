# InterSacks Digital — Website Engineering & Business Audit

**Executive summary**

| | |
|---|---|
| Audit date | 21 November 2026 |
| Repository | `lesleysacks/INTERSACKS_DIGITAL_WEBSITE` |
| Commit audited | `8b37bb8` ("Show a full-width bar while an enquiry is saving (#20)", 11 Nov 2026). The audit branch is identical to `origin/main`: `git diff HEAD origin/main` is empty. |
| Mode | Read-only. No production file was changed. No commit, push, deploy or form submission was made. The only new files are in `AUDIT_REPORT/`. |

---

## 1. Read this first: limits of the evidence

| Area | Status | Why |
|---|---|---|
| Source code, docs, assets | **Verified** | Every file was read or inspected. |
| Existing unit tests (`npm test`) | **Verified: 42/42 pass** | Run locally with Node 22. They use mocks, so they do not prove production works. |
| Existing SEO check (`scripts/check-seo.mjs`) | **Verified: passes** | Run locally. |
| Rendering, responsiveness, accessibility, Lighthouse | **Verified locally** | The repo was served on `127.0.0.1` and tested in headless Chromium with Playwright, axe-core 4.10 and Lighthouse 12.2. |
| Live site `https://www.intersacks.co.za` | **Not tested: needs external access** | This cloud container's network policy blocks the domain. Both `curl` and the web-fetch tool failed: proxy 403 and DNS ENOTFOUND. GitHub Pages normally serves `main`, and `main` is identical to the audited commit. Even so, a **live-vs-repo difference cannot be ruled out**, for example if Pages is set to another branch. |
| Apps Script deployment, Google Sheet, email delivery | **Not tested: needs Google access** | No test enquiry was sent, as instructed. The repository's own `docs/enquiry-system.md` records that on 11 Nov 2026 the `/exec` URL **redirected anonymous visitors to a Google sign-in page**. Nothing in the repo shows that this was fixed later. |
| GA4 and Search Console data | **Not tested: needs Google access** | |

---

## 2. Overall assessment

The website is a **well-built, fast, visually premium static site**. Its engineering quality is higher than that of most small South African agency sites. Technical SEO hygiene is good. The enquiry system is unusually careful about validation, duplicate submissions, formula injection and "don't claim success unless saved".

Its weaknesses are **commercial, not technical**. A visitor sees an attractive studio that does "everything" across four equal disciplines. There is **no paying-client proof, no testimonials and no price guidance**. Most of the portfolio is labelled "Independent Portfolio Concept". The hero headline ("We build. We automate. You grow.") does not say *what* is built, *for whom*, or *where*.

There are also **two operational risks that could silently lose leads or misreport tracking**. Both need the owner to check in Google:

1. **The enquiry pipeline is unverified in production.** If the Apps Script deployment still requires a Google sign-in, every form enquiry ends after 20 s with a failure message.
2. **The GA4 measurement ID in code (`G-XCN1MN0GHR`) differs from the ID on the privacy page, in the docs and in both check scripts (`G-Q85HJEHCZ7`).** Either analytics is going to an unexpected property, or the public privacy disclosure is wrong. The automated checks do not detect this.

---

## 3. Scores (0–10)

| Category | Score | Key evidence (details in the numbered reports) |
|---|---|---|
| UI/UX | **7** | Consistent navy/gold/cream identity, strong typography, clear navigation. Desktop hero has a visible overlap: the "Designed with intention" card covers the "Smart websites. Intelligent automation." text. The hero copy is abstract. |
| Mobile experience | **7** | 0 px horizontal overflow at 375, 768 and 1440 px on all 14 pages. The mobile menu toggles correctly and updates `aria-expanded`. Lighthouse flags `target-size`. Escape does not close the menu. The WhatsApp button covers heading text. The contact form starts far down the page. |
| Frontend engineering | **7** | Clean vanilla JS, no framework, defensive enquiry controller with timeout and origin checks, 0 console errors. Header, footer and `<head>` are hand-copied across 11 pages. Some dead code (Netlify payments, `js/payments.js`). Formatting is inconsistent (some pages are single-line minified). |
| Performance | **9** | Local Lighthouse mobile: 99 to 100. LCP 1.5 to 1.9 s, TBT 0 ms, CLS 0, 129 to 268 KiB. All images are WebP with width and height set. Caveats: GA was not loaded locally, and the homepage loader adds a deliberate 1 s cover on the first visit. |
| SEO | **7** | Unique titles and descriptions, canonicals, JSON-LD, sitemap, robots, branded 404, `en-ZA`. Thin service-intent content: one services page, no location or service landing pages, no reviews, no Google Business Profile link. The homepage H1 has no keywords. |
| Accessibility | **7** | Lighthouse accessibility 91 to 96. Skip link, landmarks, one H1 per page, all images have `alt`. The 404 page's buttons have 1.5:1 contrast. Breadcrumb and inline links fail `link-in-text-block`. Resources page has 10 contrast failures. The WhatsApp button sits outside any landmark. |
| Security | **6** | Strong server-side validation, honeypot, lock, idempotency key, formula and header-injection guards, no secrets in frontend JS. But the public endpoint emails **any address supplied** (abuse and quota risk), with no CAPTCHA. The rate limit is per email only. "Consent to contact = Yes" is hard-coded. A personal CV is publicly served. jsPDF loads from a CDN without SRI. |
| Conversion optimisation | **4** | Many contact routes: form, phone, email, WhatsApp, floating button. But there is no client proof, no testimonials, no pricing or "from" ranges, no packages, no maintenance offer, a generic hero, and no lead magnet. Analytics tracks clicks but not form success. |
| Maintainability | **5** | Good docs on the enquiry system and tests. But the README is badly stale: it describes a React/Django "developer portfolio", a non-existent `profile_pic.jpg`, Syne fonts and an "Antigravity" credit. There is no CI or GitHub Actions. Docs contradict code (GA ID). There is no shared layout, and `?v=` cache-busting is used on only one page. |
| Business positioning | **4** | Four equal disciplines (web, branding, automation, AI). An "Est. 2024" stamp with no client logos. A real, differentiating strength (practical SME browser tools: quote, invoice, job card, WhatsApp order) is buried on the Work and Resources pages and not sold as a service. |

**Weighted overall: about 6.3 / 10.** Technically sound, commercially under-powered.

---

## 4. Biggest strengths (protect these)

1. **Enquiry system design** (`js/enquiry-form.js`, `apps-script/EnquiryWebApp.gs`). It reports success only when it receives an `ISD-` reference from a trusted origin. It has a 20 s timeout, an idempotency key, LockService, protection against formula and header injection, a test-mode gate, and 42 mocked tests.
2. **Performance.** A static site, no framework, WebP images, `loading="lazy"`, declared image dimensions, about 77 KB of total first-party CSS and JS.
3. **Technical SEO foundation.** 12 indexable URLs, all with unique metadata, canonicals, OG/Twitter tags and JSON-LD, all enforced by `scripts/check-seo.mjs`.
4. **Honest labelling.** Concept sites say they are concepts. "In Development" work is marked as such. The payments page is `noindex` and says payments are unavailable. This protects credibility.
5. **Visual identity.** A cohesive, premium navy/gold palette with Manrope and Playfair Display, consistent on every page.
6. **Browser business tools** (invoice, quote, job card, WhatsApp order builder). Real, working demonstrations of value for SMEs.

## 5. Biggest weaknesses

1. No evidence of paying clients: no testimonials, case studies, results or logos.
2. Positioning is too broad, and the hero headline is not specific.
3. No price anchoring. SA SME buyers compare "from R x" packages.
4. Enquiry and analytics production state are unverified, and docs and code contradict each other.
5. Maintenance burden: every global change, such as a nav link, has to be made by hand in 11+ files.
6. There is no CI, so tests that exist are never run automatically before Pages publishes.

## 6. Most serious risks

| # | Risk | Priority |
|---|---|---|
| 1 | Form enquiries lost if the Apps Script deployment is not anonymous-accessible or `ENVIRONMENT≠production` | **P0** |
| 2 | GA4 ID mismatch: wrong or empty reporting, plus an inaccurate privacy disclosure | **P0** |
| 3 | Public endpoint can be used to send acknowledgement emails from the owner's Gmail to arbitrary addresses. This exhausts the daily MailApp quota, after which owner notifications fail. It also damages sender reputation. | **P1** (high) |
| 4 | POPIA: consent is recorded as "Yes" without an explicit consent step, and analytics has no lawful-basis statement. A test (`check-seo.mjs`) actively *fails* if the privacy page mentions "lawful basis" or "consent mode". | **P1** |
| 5 | A personal CV (`assets/L.S CV 2026.pdf/.docx`) with personal contact data is publicly downloadable and unlinked | **P1** |

## 7. Biggest revenue opportunities

1. **Productised packages with "from" pricing** (for example Starter site, Business site, Website + WhatsApp ordering, Care plan). This is the fastest conversion lift and costs nothing to build.
2. **Monthly website care / maintenance retainer.** Recurring revenue that is currently not offered at all.
3. **Turn the browser tools into a lead engine.** Offer "custom-branded quote, invoice and job-card tool for your business" as a fixed-price product, plus "use the free tool → get it branded" CTAs.
4. **WhatsApp-first ordering for local SMEs** (salons, liquor stores, takeaways). The order builder already exists.
5. **Collect 3 to 5 testimonials or case studies**, even from small or discounted early jobs.

## 8. Recommended next steps (no code changes until approved)

1. **Owner checks in Google (30 minutes):** (a) which GA4 property is the real one, (b) the Apps Script deployment access is "Anyone", (c) `ENVIRONMENT=production`, (d) one controlled, clearly labelled test enquiry, as `docs/enquiry-system.md` describes, (e) the Sheet is not shared publicly.
2. Approve the **7-day plan** in `10_PRIORITISED_ACTION_PLAN.md`: GA ID fix, consent checkbox, hero copy, 404 contrast, hero overlap, CV removal, README rewrite, a CI workflow running the existing tests.
3. Then the **30-day plan**: packages and pricing page, testimonials, care plan, service landing pages, Turnstile or reCAPTCHA plus a global rate limit on the Apps Script.

See `09_IMPROVEMENT_ROADMAP.md` for every recommendation in full and `10_PRIORITISED_ACTION_PLAN.md` for the schedule and the final review answers.
