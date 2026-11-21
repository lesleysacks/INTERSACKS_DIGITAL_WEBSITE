# 03 — Engineering Audit (Phase 4)

## 3.1 HTML

| Aspect | Finding |
|---|---|
| Semantics | Good: `header`, `nav[aria-label]`, `main#main`, `section`, `article`, `footer`, skip link, `aria-current` breadcrumbs, `ol` for process. |
| Heading hierarchy | 1 × H1 per page (verified). Services and Work use H2 per item, which is sensible. `index.html` service cards use H3 under an H2, which is fine. |
| Language | `lang="en-ZA"` everywhere. Good. |
| Valid markup | No parse-breaking errors were observed in Chromium. **Not run:** W3C validator (no network in this container). |
| Landmarks | The `.whatsapp-button` sits outside all landmarks (axe `region`, every page). `payments.html` has an `<aside>` inside `<section>` (axe `landmark-complementary-is-top-level`). |
| Decorative text | `.contact-shape` "iS" has `aria-hidden` but is still flagged by contrast tools. Acceptable. |
| Contact form | Labels wrap inputs; there is `autocomplete`, `maxlength`, `required` and a `fieldset/legend` for the service radios. The honeypot is `aria-hidden` with `tabindex=-1`. **Missing:** consent checkbox, privacy link next to submit, `aria-invalid` and per-field error association (one shared status line instead). |
| Reuse | **No templating.** Header, mobile nav, footer, WhatsApp button, font links and JSON-LD `ProfessionalService` are copied by hand into 11 pages. Adding one nav item means editing 11 files plus 4 tools. |
| Formatting | `services.html` and `process.html` are single-line blobs. This makes review and diffs impractical. |

## 3.2 CSS

| Aspect | Finding |
|---|---|
| Size | `styles.css` 34 KB (1717 lines), `resources.css` 14 KB. Reasonable. |
| Tokens | 12 custom properties (colours, fonts). No spacing, radius, type-scale or z-index tokens, so these values are repeated as literals. |
| Responsive architecture | Desktop-first, essentially **two breakpoints** (`max-width:760px`, `761–1100px`). It works (0 overflow), but there are few intermediate refinements. |
| Specificity | Low; only 3 `!important` in `styles.css`. Good. |
| Naming | Mostly descriptive BEM-ish (`homepage-project-cover`, `service-proof-cta`). Some page-specific one-offs accumulate over time. |
| Transition overlay | `.js::before` is a full-screen navy overlay at `opacity:1` until `page-ready` is set on `DOMContentLoaded`. If `script.js` fails *after* adding `js`, the page stays covered. The risk is low because both lines are in the same file, but it is a single point of failure for visibility. |
| Reduced motion | Respected (`prefers-reduced-motion` in CSS and JS). Good. |
| Unused CSS | Not measured precisely. Lighthouse did not flag unused CSS as significant at this size. |

## 3.3 JavaScript

### `js/script.js` (170 lines)
- **Good:** guards for `sessionStorage` exceptions, a loader safety timeout, bfcache `pageshow` reset, modifier-key and new-tab handling in page transitions, and graceful IntersectionObserver fallback.
- **Issues:**
  - The homepage loader forces a **≥1 s cover** on the first visit per session. This is a pure UX cost, and it delays perceived LCP.
  - `internalPages` hard-codes 7 page names. New pages silently get no transition.
  - The mailto fallback text says "Until that URL is set". It is now dead in production but still useful as a fallback.
  - The mobile menu has no Escape handler and no focus return.

### `js/enquiry-form.js` (279 lines)
- **Very good:** a UMD-style factory (`createEnquiryController`) that is testable in Node. It checks endpoint format, origin (`script.google.com` and `*-script.googleusercontent.com`), message channel, a submission-key match and the reference format. It has a 20 s timeout, a busy-lock and a loading state.
- **Issues:**
  - The success path requires a `postMessage` from Google's sandbox frame. Changes in Google's HtmlService frame nesting have broken this before (#17, #18). It is fragile by nature and has **no live monitoring**.
  - A timeout shows a failure message. A late success that arrives after the timeout is ignored (`pending` is null), so the user may resubmit. Idempotency via the same `submissionKey` prevents a duplicate row, which is a good mitigation. Note that the key is reset only on success.
  - No analytics event for `generate_lead` / form success, so the most important conversion is **not measured**.

### `js/analytics.js` (138 lines)
- Clean, ES5-compatible IIFE with a singleton guard. It loads `gtag.js` only on production hosts and uses a delegated click listener.
- **Issue:** the measurement ID mismatch (see 06/08). No Consent Mode defaults.

### `js/resources.js`
- Filtering only. No `innerHTML` use (no XSS surface).

### `js/payments.js`
- **Dead.** No page includes it. It calls `/.netlify/functions/*`, which do not exist on GitHub Pages.

### Browser tools (`assets/*.html`)
- 1,000–1,700 lines each, with inline CSS and JS. No shared code between the four, so totals, currency and branding logic are duplicated.
- jsPDF 2.5.1 from cdnjs **without `integrity`/SRI** (3 pages). A CDN compromise would run arbitrary JS on these pages.
- No `localStorage`, so data is lost on refresh. That is privacy-friendly, but a usability gap for a "tool".

## 3.4 Apps Script backend (`apps-script/EnquiryWebApp.gs`, 1098 lines)
- **Strengths:** a clear lifecycle (RECEIVED→NEW) that cannot be confirmed from the web. Script properties for configuration. LockService. Header-schema checks. Formula-injection guard (`'` prefix plus text format). Email-header CRLF stripping. HTML escaping in the owner email. Error Log tab with personal data redacted. TEST_MODE gate. `runSafeSelfTest()`.
- **Weaknesses:**
  - Reads the **entire Leads sheet** (`getMaxRows()`) on each submission to find duplicates, the next row and the next reference. That is O(n) per enquiry, which is fine at hundreds of rows and slow at tens of thousands.
  - Rate limit is per email hash only (see 06).
  - `KNOWN_SPREADSHEET_ID` is hard-coded *and* required to match the property. It is a deliberate safety pin, but it puts the ID in a public repo.
  - `allowedOrigins` is parsed but never used.
  - The customer acknowledgement is sent before the owner notification. If the quota runs out, the owner notification is the one that fails.

## 3.5 Architecture and future backend integration

| Topic | Assessment |
|---|---|
| Separation of concerns | Reasonable: content in HTML, style in CSS, behaviour in JS, backend in Apps Script. |
| Configuration | Hard-coded in many places: phone number in about 30 places, email in about 25, WhatsApp text, GA ID and the endpoint URL in HTML attributes. No single `site config`. |
| Backend readiness | The form controller already isolates "endpoint + response protocol". Swapping in Django, Flask or Express is straightforward: POST the same fields to `/api/enquiries`, return JSON `{ok, reference}`, and replace the iframe/postMessage adapter with `fetch`. **Recommendation:** add a small `transport` abstraction now so the controller supports both `iframe-postMessage` and `fetch-json`. |
| Templating without a framework | Use a **build-time include step** that keeps the output as static HTML. For example, a ~50-line Node script that injects `partials/header.html` and `partials/footer.html` into `src/*.html` → `/` during a GitHub Action. No runtime framework, no change for visitors. Later the same partials map 1:1 onto Django or Jinja templates. |

## 3.6 Technical debt register

| Debt | Real impact |
|---|---|
| 11× duplicated layout | Every nav or footer change risks inconsistency. This has already happened: the payments page uses a different WhatsApp message, and the `privacy.html` list says tools link privacy, which needs manual upkeep. |
| No CI | Tests and the SEO check exist but run only when someone remembers. The GA mismatch slipped through. |
| Stale README and contradictory docs | Wastes developer time and can mislead AI-assisted edits. Several recent commits were agent-authored. |
| Dormant Netlify payment code on `main` | Confusion, and a future accidental-deploy risk |
| Inline monolithic tool pages | Hard to rebrand per client, which matters if the tools become a product |
| Hard-coded contact details everywhere | A phone or email change means about 60 edits |
