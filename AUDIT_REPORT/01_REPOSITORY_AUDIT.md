# 01 — Repository Audit (Phase 1)

## 1.1 Git state

| Item | Finding (verified) |
|---|---|
| Current branch | `claude/intersacks-website-audit-hfr7fn`. It is identical to `origin/main` (`8b37bb8`). |
| Working tree | Clean before the audit. The only addition is `AUDIT_REPORT/`, which is not committed. |
| History | 31 commits, 16 Jul 2026 → 11 Nov 2026. Authors include the owner, a Cursor agent and other AI-assisted branches (`cursor/seo-optimisation-8584` is referenced in docs). |
| Recent focus | #16–#20: the Apps Script enquiry repair (five consecutive fixes in about 1 day, which points to a fragile deploy and test loop). `76309a9`: GA measurement ID changed in `js/analytics.js` only. |
| GitHub Actions | **None.** There is no `.github/` directory. |
| Hosting | GitHub Pages (`CNAME` = `www.intersacks.co.za`). There is also a `netlify.toml` and Netlify functions, which are not used on Pages. |

## 1.2 Structure and size

Total about 1.8 MB excluding `.git`.

```
/ (11 HTML pages + 404 + Google verification file)
  index, about, services, work, resources, process, contact, privacy, payments, 404
css/      styles.css (34 KB, 1717 lines), resources.css (14 KB)
js/       script.js, analytics.js, enquiry-form.js, resources.js, payments.js (unused)
assets/   4 browser tools (invoice/quote/job-card/whatsapp, 1067–1678 lines each, inline CSS+JS)
          templates/greeting-cards (2, MIT, noindex)
          resources/ (2 markdown guides, 3 python scripts)
          images/ (17 WebP), video/README.md (no video)
          L.S CV 2026.pdf, L.S CV 2026.docx   ← personal CV, not linked anywhere
images/   business_card.jpeg (OG image)
apps-script/ EnquiryWebApp.gs (1098 lines), appsscript.json
netlify/functions/ payfast-*, paypal-*, payment-utils  ← dormant on GitHub Pages
docs/     analytics.md, enquiry-system.md, seo-report.md
scripts/  check-seo.mjs, check-analytics.mjs
tests/    enquiry/*.test.mjs (node:test), browser-smoke-tests.mjs (manual CDP)
```

## 1.3 What the site does (verified against source)

| Function | Implementation | Status |
|---|---|---|
| Marketing pages (Home, About, Services, Work, Process, Resources, Contact, Privacy) | Static HTML with shared `styles.css` | **Verified locally**: render without console errors and with no broken internal links. 23 unique external links, not crawled. |
| Mobile navigation | `js/script.js` toggle | **Verified locally**: opens, sets `aria-expanded=true`. Escape does **not** close it. |
| Scroll reveal, homepage loader, page fade transitions | `js/script.js` + CSS `.js::before` overlay | **Verified locally** |
| Contact enquiry → Apps Script → Sheet + 2 emails | `js/enquiry-form.js` (hidden iframe POST + `postMessage`), `apps-script/EnquiryWebApp.gs` | Client validation **verified locally**: empty form gives "Enter your full name.", bad phone gives "Enter a valid phone number.", no network POST. Backend logic **verified by mocks only**. Production: **not verified, needs Google access.** |
| GA4 + custom events | `js/analytics.js`, loads `gtag.js` only on the production host | Logic **verified by reading**. Real ID **inconsistent** (see 06). |
| WhatsApp contact | `wa.me/27843252262` deep links, floating button | Link format verified |
| Browser tools (invoice, quote, job card, WhatsApp order) | Standalone pages, jsPDF 2.5.1 from cdnjs | Pages render. PDF export not tested because the CDN is blocked in this container. |
| Resource Hub (filterable) | `resources.html`, `js/resources.js`, `css/resources.css` | Renders. One `scrollable-region-focusable` issue on mobile. |
| Greeting-card templates | Standalone, `noindex` | Render |
| Online payments | `payments.html` notice + Netlify functions + `js/payments.js` | **Disabled by design.** The page says payments are unavailable. The functions cannot run on Pages. `js/payments.js` is not included by any page. |

## 1.4 Incomplete, duplicated, abandoned or broken

| Item | Evidence | Assessment |
|---|---|---|
| **README.md is stale and inaccurate** | Describes a "developer portfolio", React skills, a "Dark/light mode switcher", "skill progress indicators", `images/profile_pic.jpg`, Syne & DM Sans fonts, and credits "Antigravity (Google DeepMind team)". None of these exist in the code. | Misleading for any future developer. Rewrite. |
| **GA4 ID contradiction** | `js/analytics.js:2` = `G-XCN1MN0GHR`. `privacy.html:54`, `docs/analytics.md:3`, `scripts/check-seo.mjs:124` and `scripts/check-analytics.mjs:60,138` = `G-Q85HJEHCZ7`. | **P0**. See 06 and 08. |
| **Docs contradict each other on the form** | `docs/analytics.md`: "The form still opens the visitor's email app." `docs/enquiry-system.md` says it now posts to Apps Script. | Update docs |
| Netlify payment stack | `netlify.toml`, `netlify/functions/*`, `PAYMENTS.md`, `.env.example`, `js/payments.js` | Abandoned or parked. Keep in a branch or folder clearly marked "not deployed", or remove from `main`. |
| `js/payments.js` | Not referenced by any HTML | Dead code |
| `assets/images/projects/valentines-cards.webp` | Not referenced by any HTML | Unused asset (57 KB) |
| `assets/video/README.md` | No video present | Placeholder |
| CV files in `assets/` | Not linked. Contains personal contact details. Publicly served by Pages. | Privacy risk. Remove from the public site. |
| `KNOWN_SPREADSHEET_ID` hard-coded in `.gs`, and the Sheet ID printed in `docs/enquiry-system.md` | A public repository (GitHub Pages on a free plan requires public) | Not a credential on its own, but it should not be published. Confirm the Sheet's sharing is restricted. |
| `ALLOWED_ORIGINS` script property | Read in `getConfiguration()`, never enforced | Documented as "kept for compatibility". Dead config. |
| Mixed formatting | `services.html`, `process.html` are effectively single-line. Others are pretty-printed. | Hurts diffs and reviews |
| Inconsistent cache busting | Only `contact.html` uses `styles.css?v=lead-progress` | Other pages can serve stale CSS after deploys |
| 11 copies of header, footer, `<head>` | `grep -c nav-shell *.html` → 1 per page | Main maintainability debt |

## 1.5 What should be preserved

- The enquiry controller and Apps Script logic, including validation, idempotency, injection guards and test-mode gate, and the 42 tests.
- The SEO infrastructure: metadata, canonicals, JSON-LD, sitemap, robots, 404, `check-seo.mjs`.
- The visual identity, CSS tokens and page structure.
- The honest labelling of concept, prototype and in-development work.
- The browser tools and the Resource Hub.
- The framework-free architecture.
