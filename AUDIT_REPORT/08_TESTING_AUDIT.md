# 08 — Testing & Verification Audit (Phase 10)

## 8.1 Existing tests and checks

| Asset | What it covers | Run here? | Result |
|---|---|---|---|
| `npm test` → `tests/enquiry/apps-script.test.mjs`, `frontend.test.mjs` (node:test, 42 tests) | Apps Script logic with an in-memory Sheet, fake MailApp and Lock: validation, duplicates, locks, references, statuses, injection, test-mode, honeypot, public payload. Frontend controller: endpoint handling, postMessage trust, timeout, mailto fallback. | **Yes** (Node 22.23) | **42 pass / 0 fail** |
| `node scripts/check-seo.mjs` | Unique titles and descriptions, canonical host, one H1, JSON-LD parse, alts, sitemap, privacy wording, enquiry config invariants | **Yes** | **Pass** ("12 indexable pages and 12 sitemap URLs") |
| `scripts/check-analytics.mjs` | GA loader, events, privacy text, via the Chrome DevTools Protocol | Not run (needs a manually started Chrome with a remote debug port) | – |
| `tests/browser-smoke-tests.mjs` | Layout at 5 widths on 14 pages, via CDP | Not run (same prerequisite) | – |
| GitHub Actions | **None** | – | – |

## 8.2 Unreliable or misleading tests

1. **GA ID is never checked against `js/analytics.js`.** `check-seo.mjs` asserts that `privacy.html` contains `G-Q85HJEHCZ7`. `check-analytics.mjs` uses the same ID only as a literal. Both pass while the code ships `G-XCN1MN0GHR`. **A green test hides a real inconsistency.**
2. **`check-seo.mjs:136` forbids compliance wording.** It fails if `privacy.html` contains "lawful basis", "consent mode" etc. This was intended to stop false claims, but it also blocks legitimate POPIA improvements.
3. **Mocks only for the enquiry backend.** `docs/enquiry-system.md` itself says "A passing mock is not evidence that the live website, spreadsheet, or email delivery works." Five consecutive fix PRs (#16–#20) show that the real Apps Script runtime and editor behave differently from the mocks.
4. `frontend.test.mjs` "contact form posts to the supplied Apps Script web app" hard-codes the deployment URL. A redeploy (new `/exec` ID) breaks the test, which is good as a tripwire but means test maintenance on every deploy.
5. Browser checks depend on a manual CDP setup, so they are effectively never run.

## 8.3 Results of checks performed during this audit (local, read-only)

| Check | Status |
|---|---|
| Pages render at 375, 768 and 1440 with 0 horizontal overflow (14 pages) | **Verified working** |
| No console errors on site pages | **Verified working** |
| No broken internal links | **Verified working** |
| Mobile menu opens and closes via the toggle | **Verified working** |
| Mobile menu closes on Escape | **Verified broken** (stays open) |
| Contact form client validation | **Verified working** |
| Contact form → Apps Script → Sheet → emails | **Requires external access** (not tested by instruction) |
| GA4 data arriving in the intended property | **Requires external access**. Code/docs mismatch **verified**. |
| 404 page buttons readable | **Verified broken** (contrast 1.5:1) |
| Desktop hero card overlap | **Verified broken (visual)** |
| Tools: PDF generation | **Not tested** (CDN blocked in sandbox) |
| WhatsApp deep links open the correct chat | **Partially verified** (URL format correct; not opened) |
| Live site matches repo | **Requires external access** |
| Lighthouse scores | **Verified locally** (see 04) |
| axe-core WCAG 2 A/AA scan | **Verified locally**: issues listed in 02/03 |

## 8.4 What should be added

| Addition | Why | Effort |
|---|---|---|
| **GitHub Actions workflow**: `npm test` + `check-seo.mjs` on every PR and push to `main` | Stops regressions before Pages publishes | S |
| **Consistency test**: the GA ID in `js/analytics.js` must equal the ID in `privacy.html` and `docs/analytics.md` | Closes the gap that let the mismatch through | XS |
| **Playwright smoke test in CI** (Chromium is pre-installed on runners via `npx playwright install`): overflow, console errors, links, mobile menu, form validation, axe serious/critical = 0 | Replaces the manual CDP scripts | M |
| **Link checker** for external links (scheduled weekly) | 23 external links to demo sites can rot | S |
| **Production heartbeat** (Apps Script time-driven trigger): daily self-test + email if the Error Log has new rows or `owner=failed` | The only realistic way to know the live pipeline works without fake leads | S |
| **Post-deploy check**: fetch the live `contact.html` and assert the endpoint attribute equals the repo | Detects live/repo drift | S |
| Lighthouse CI budget (perf ≥ 90, a11y ≥ 95) | Guards the current strength | S |

## 8.5 Missing deployment checks

- No branch protection or required checks (cannot be verified without GitHub settings access; assumed absent because no workflows exist).
- No preview environment; `main` publishes directly.
- No Apps Script versioning in the repo (`clasp` not used), so the deployed script version cannot be tied to a commit.
