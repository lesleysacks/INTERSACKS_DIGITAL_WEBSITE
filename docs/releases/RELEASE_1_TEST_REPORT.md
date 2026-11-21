# Release 1 — Test report

Run on 21 November 2026 in a cloud container (Node 22.23.5, Chromium 1243 via Playwright). **Every Google service in these tests is simulated.** No request reached the live Apps Script, the spreadsheet, Gmail or the GA4 property. Passing tests are **not** evidence that the live deployment works. That needs one approved live enquiry after deployment (owner action D5).

## 1. Results

| Suite | Command | Result |
|---|---|---|
| Original Apps Script tests (unchanged) | `npm test` (part) | **28 / 28 pass** |
| Original frontend tests (unchanged) | `npm test` (part) | **14 / 14 pass** |
| Release 1 backend security | `tests/enquiry/release-1-security.test.mjs` | **29 / 29 pass** |
| Release 1 frontend + analytics | `tests/enquiry/release-1-frontend-analytics.test.mjs` | **9 / 9 pass** |
| Release 1 public files, privacy, CSP | `tests/enquiry/release-1-public-files.test.mjs` | **6 / 6 pass** |
| **All unit tests** | `npm test` | **86 / 86 pass** |
| SEO check (now also checks GA ID consistency) | `npm run check:seo` | **Pass** (12 pages, 12 sitemap URLs) |
| Release 1 browser checks | `npm run test:browser` | **53 / 53 pass** |
| Existing analytics browser check (CDP) | `node scripts/check-analytics.mjs` | **Pass** |
| Existing smoke test (CDP) | `node tests/browser-smoke-tests.mjs` | **Stops at line 768**, waiting for jsPDF from cdnjs, which this container's network blocks. **The same run against unchanged `main` stops at the same line**, so this is environmental. All checks before that point passed on both branches. |
| Release gate | `npm run check:release` | **Fails by design** until the 4 privacy placeholders are replaced |
| Layout and axe sweep (audit tooling, 14 pages × 3 widths) | scratch script | 0 px overflow, no console errors, no broken internal links. axe: no new issue types; the contact page's new privacy link passes `link-in-text-block`. |

## 2. Coverage against the required cases

| Required case | Where tested | Notes |
|---|---|---|
| Valid enquiry submission | original #1; R1 "valid Release 1 enquiry…"; browser journey | Owner mail first, then customer |
| Invalid email | original #3; R1 17-address list (lists, display names, CRLF, full-width, long parts) | Nothing saved or sent |
| Missing required fields | original #2, #4, #5; R1 "each required field…" | Includes invisible-only names |
| Excessively long fields | R1 "excessively long fields…" | Truncation per field; JSON and form bodies > 20,000 rejected |
| Unexpected input fields | R1 "unexpected fields are ignored…", "URL-encoded form post…" | `status`, `to`, `cc`, `bcc`, `replyTo`, `ownerEmail`, `consent`, booking fields, `__proto__` |
| Duplicate submissions | original #6, #14; R1 key replay; R1 repeat within 24 h | Repeat saved with `Duplicate of`, no second acknowledgement |
| Rate-limited submissions | R1 per-email, per-phone, global | Global message matches the page's safe-message rule; log has no personal data |
| Honeypot | original; R1 padded honeypot | |
| Form timing | R1 too fast, empty, malformed, out of range, absent (legacy allowed), absent with `REQUIRE_FORM_TIMING` | |
| Formula injection | original; R1 every free-text column, leading `=`, `+`, `-`, `@`, tab | |
| HTML/script injection | R1 owner email escaped; customer email free of injected text | |
| Arbitrary recipient manipulation | R1 unexpected-fields test; strict email list; fixed template | Only `owner@` and the enquiry address ever receive mail |
| Email abuse controls | R1 hourly acknowledgement cap; low MailApp quota; retry limits | Owner always notified |
| Consent defaults and marketing | R1 no automatic Yes; only `yes` opts in; not required; static check: checkbox unchecked and not required; browser: unchecked not sent, ticked sent as `yes` | |
| Analytics conversion events | R1 frontend: one lead per reference; none on timeout, error, TEST_MODE, untrusted origin, wrong key, missing reference, duplicate; browser: one `generate_lead` after the mocked confirmed save | |
| PII exclusion from analytics | R1 analytics: extra fields in the event ignored; browser: no name, email, phone, business, message or reference in any dataLayer event | |
| Duplicate analytics events | R1 "loading analytics twice…"; browser re-dispatch | |
| Public sensitive-file exposure | R1 public files: no CV, document, backup or key types published; secret-pattern scan; browser: CV path returns 404 | |
| Privacy policy consistency | R1 public files: one GA ID across code, notice and docs; all events disclosed; providers, rights and regulator present; no compliance claims; non-tracking pages really lack the tag; notice version = notice date; placeholders listed in owner actions | |
| CSP does not break the site | Browser: 0 violations and 0 script errors on all 10 pages under the production hostname; enquiry journey under CSP; resource search Enter does not reload. Static: no inline scripts or handlers; no `form-action`/`frame-src`/`default-src` | The real Google tag could not load here (proxy), so GA's own requests were not exercised. Verify in GA4 Realtime after deploy (owner action B4). |

## 3. Test limitations

- Apps Script, Sheets, MailApp, CacheService and LockService are in-memory fakes. Real quota numbers, cache eviction and MailApp's parsing of addresses were not observed.
- The browser test cannot follow Google's real redirect to `*.googleusercontent.com`, so the mock replies from `script.google.com`. The CSP does not restrict forms or frames, so that hop is unaffected.
- `googletagmanager.com`, `google-analytics.com` and `cdnjs.cloudflare.com` are blocked by this environment's network policy. GA collection was additionally aborted on purpose.
- Live site and live Apps Script: **not tested**, as instructed.

## 4. How to re-run

```bash
npm test                    # 86 unit tests, no network
npm run check:seo
npm run test:browser        # needs Playwright + Chromium available to Node
npm run check:release       # fails until privacy placeholders are replaced
```
