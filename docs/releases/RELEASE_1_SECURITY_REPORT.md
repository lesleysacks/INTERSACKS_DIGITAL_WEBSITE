# Release 1 — Security report (Phase A findings and outcomes)

Branch `feature/release-1-security-compliance`, based on `main` at `8b37bb8`. Read-only inspection came first. Changes were then made in small commits. Nothing was deployed, and no request was sent to the live Apps Script.

**Legend.** *Verified* = shown in the source or by a local test. *Potential* = a plausible risk that follows from the design, not demonstrated against production (no live testing was allowed). Severity reflects the impact on this business.

## 1. Scope inspected

`contact.html`, `js/enquiry-form.js`, `js/script.js`, `js/analytics.js`, `apps-script/EnquiryWebApp.gs`, `apps-script/appsscript.json`, `privacy.html`, `docs/*.md`, every tracked file GitHub Pages publishes, the four browser tools (`assets/*.html`), the Netlify payment functions, and the third-party hosts that pages load (Google Fonts, Google Tag Manager/GA4, cdnjs jsPDF, Google Apps Script).

## 2. Findings

| # | Finding | Severity | Evidence | Risk | Recommended fix | Status |
|---|---|---|---|---|---|---|
| F1 | The public web app emails an acknowledgement to **any address submitted**, and the only abuse control was a per-email limit | High (potential) | `sendCustomerAcknowledgement` → `MailApp.sendEmail({to: record.email})`; old `withinRateLimit_(email)` | A bot rotating addresses makes the owner's Google account send mail to victims, uses up the MailApp daily quota (after which **owner notifications fail**), and can harm sender reputation | Layered limits; owner first; quota reserve; fixed template | **Fixed within platform limits** (§3) |
| F2 | Rate limit keyed **only** on the email address | Medium (verified) | old `withinRateLimit_` | Trivially bypassed | Add per-phone and whole-app limits | **Fixed** |
| F3 | Lax email pattern accepted address lists and display names, such as `a,b@c.com` or `Name<a@b.com>` | Medium (verified pattern; potential effect) | old `isEmail_`: `^[^\s@]+@[^\s@]+\.[^\s@]{2,}$` | How MailApp handles such strings is unverified; it may treat them as several recipients | Strict single-address pattern, server and client | **Fixed** |
| F4 | `Consent to contact` written as an automatic `Yes` | Medium (verified, compliance) | `saveEnquiry` wrote `'Yes'` with no consent control on the form | A recorded "consent" that was never given | Record what actually happened, plus evidence | **Fixed** (privacy review §2) |
| F5 | GA4 ID inconsistent: the code sends to `G-XCN1MN0GHR`, while the privacy page, docs and checks said `G-Q85HJEHCZ7` | Medium (verified) | `js/analytics.js:2` vs `privacy.html`, `docs/analytics.md`, `scripts/check-*.mjs` | Inaccurate public disclosure; tests gave false assurance | Align on the owner-confirmed active ID; add a consistency check | **Fixed** |
| F6 | Personal CV publicly published | Medium (verified in repo) | `assets/L.S CV 2026.pdf/.docx`, unlinked, contains contact details; Pages publishes every tracked file | Personal data exposure | Remove from the published tree; history kept | **Fixed** (still in git history; owner decision C8) |
| F7 | Visitor-controlled text (the name) placed in the email sent to the submitted address | Low–Medium (verified) | `'Hello ' + record.name` | Spam or phishing text relayed from the owner's account | Greet by name only if it looks like a name | **Fixed** |
| F8 | JSON requests passed **all** fields through; `status`, `bookingDate`, `bookingDetails` were accepted from the web | Low (verified) | `jsonPayload_`, `validateEnquiry` | Attacker text in owner emails and notes; risk of future field misuse | Allowlist fields; drop booking and status | **Fixed** |
| F9 | Control, bidi-override and zero-width characters not removed | Low (verified) | `cleanText_` only collapsed whitespace | Spoofed names and filenames in the sheet and emails; hidden text | Normalise to NFC and strip | **Fixed** |
| F10 | No bot friction other than a honeypot | Low (verified) | – | Naive bot spam | Minimum form-completion time (deterrent only) | **Added** |
| F11 | Re-posting a key whose email failed re-sent **both** emails with no cap | Low (verified) | old `notificationNeedsRetry_` path | Replay could send repeated owner and customer mail | Retry failed channels only, at most 2 per key per hour | **Fixed** |
| F12 | No CSP or referrer policy | Low (verified) | no headers on GitHub Pages; no meta tags | Less defence in depth against injected script | Meta CSP plus referrer meta | **Partly fixed** (§4) |
| F13 | Spreadsheet formula injection | — | `asText_`, `formulaPrefix_` already present | — | Keep; extend to a leading tab or CR | **Already mitigated; extended and tested** |
| F14 | HTML injection in the owner email | — | `escapeHtml_` already used | — | Keep | **Already mitigated; tested** |
| F15 | Spreadsheet ID in the public repository | Low (verified) | `KNOWN_SPREADSHEET_ID`, docs | Exposure if the sheet is ever link-shared | Keep restricted sharing; the ID is a safety pin against writing to the wrong sheet | **Accepted; owner check B3** |
| F16 | jsPDF loaded from cdnjs **without SRI** on 3 tool pages | Low (verified) | `assets/*_generator.html` | A CDN compromise could run script on those pages | Add `integrity` with a verified hash, or self-host | **Not changed**: cdnjs is unreachable from this environment, so a hash could not be verified against the served file. A wrong hash would break PDF downloads. |
| F17 | No IP-based limiting is possible | Limitation | Apps Script web apps do not expose the client IP | Distributed abuse can still reach the global cap | Global cap; CAPTCHA if needed (owner decision C6) | **Documented** |
| F18 | Web app runs as the owner with anonymous access | Inherent (verified) | `appsscript.json`: `USER_DEPLOYING`, `ANYONE_ANONYMOUS` | Anyone can POST | Required for a public form; controls above | **Accepted** |
| F19 | `postMessage(payload, "*")` | Informational | `createHtmlResponse` | Payload is reference, status and key only; the receiver checks the origin | — | **Accepted** |
| F20 | Inline `onsubmit` on `resources.html` | Low (verified) | `resources.html` | Would break under a strict CSP | Move to `js/resources.js` | **Fixed** |
| F21 | Dormant Netlify payment functions in the public repo | Low (verified) | `netlify/functions/*` | Not executable on GitHub Pages; a risk only if deployed elsewhere | Isolate or remove in a later release | **Not changed** (out of scope) |
| F22 | Visitor-facing error text | — | `publicPayload_` returns fixed messages | — | Keep; tested that exceptions, IDs and emails never appear | **Verified** |
| F23 | Sensitive-file sweep: `.env`, keys, backups, credentials | — | `git ls-files` sweep and secret-pattern scan | None found besides the CV. `.env.example` holds placeholders only | — | **Verified, plus a regression test** |

## 3. Enquiry protections now in place (server-side unless stated)

1. Field allowlist (`pickFields_`). Non-string values are ignored. Requests over 20,000 characters are rejected.
2. Text sanitisation (`cleanText_`): NFC, control, bidi and invisible characters removed, whitespace collapsed, per-field maximum lengths (name 120, email 254, phone 40, business 160, message 4000).
3. Strict single-address email validation (`isEmail_`, mirrored in `js/enquiry-form.js`).
4. Service allowlist (`SERVICE_VALUES`). Page-path validation. Phone normalisation (unchanged).
5. Honeypot (unchanged) and minimum completion time: `formElapsedMs` 3 s – 24 h. *A deterrent only, since a scripted client can send any value.*
6. Hourly limits: 5 per email, 5 per phone, 30 for the whole web app (configurable). Fixed hourly windows in `CacheService`. If the cache is down, the per-person limits fail open so a real customer is not blocked.
7. Duplicate handling: the same submission key returns the original reference. The same email, service and message within 24 h is saved with `Duplicate of`, excluded from `Counted`, and gets no second acknowledgement.
8. Email abuse: owner notified first. The customer acknowledgement goes only to the validated address on the saved enquiry, uses a fixed template, and is skipped above 15 per hour or when the remaining MailApp quota is ≤ 20 (the reserve for owner mail). Retries cover failed channels only, at most 2 per key.
9. Formula injection (`asText_`) and HTML escaping in emails (unchanged, now tested more widely).
10. Generic visitor messages. The Error Log and console contain no personal data (tested).

## 4. Security headers and hosting (Phase F)

GitHub Pages does not allow custom response headers, and a `_headers` or `netlify.toml` file has no effect there, so none was added. Implemented and not implemented:

| Protection | Status on GitHub Pages | Done in this release |
|---|---|---|
| HTTPS and HSTS | Provided by GitHub Pages when "Enforce HTTPS" is on (the earlier SEO report observed HSTS) | Not changed. Owner can confirm the setting. |
| Content-Security-Policy | **Meta tag** supported, except `frame-ancestors`, `report-uri` and `sandbox` | **Added** to the 10 site pages: `script-src 'self' https://*.googletagmanager.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https://*.google-analytics.com https://*.googletagmanager.com; connect-src 'self' https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com; object-src 'none'; base-uri 'self'; upgrade-insecure-requests` |
| CSP and the enquiry form | – | **Deliberately no `default-src`, `form-action` or `frame-src`**, so the Apps Script POST, its redirect to `*.googleusercontent.com` and the hidden iframe work exactly as before. Tightening these needs a verified live test (Release 2 candidate). |
| `style-src 'unsafe-inline'` | – | Needed for the `style="--swatch:…"` attributes on `resources.html`. Lower risk than script injection. |
| Referrer-Policy | Meta tag supported | **Added**: `strict-origin-when-cross-origin`, the browser default made explicit |
| X-Content-Type-Options, Permissions-Policy, X-Frame-Options / `frame-ancestors` | **Headers only**; not possible on Pages | Not possible. Needs a CDN or proxy (owner decision C7). |
| Browser tools (`assets/*.html`) | – | No CSP: they use large inline scripts and jsPDF from cdnjs. Would need refactoring first. |

The CSP was exercised in Chromium under the production hostname (see the test report). The live Google tag could not be loaded from this environment, so the GA4 hosts in the policy follow Google's documented list and must be confirmed in GA4 Realtime after deployment (owner action B4).

## 5. Remaining risks

- Distributed spam can still reach the global hourly cap and briefly block genuine form use. Visitors then see the phone and WhatsApp number. A CAPTCHA (owner decision C6) is the next control.
- The bot timing check can be forged by a scripted client.
- CacheService entries can be evicted early, so limits are best-effort.
- The live Apps Script has not been updated. Until the owner deploys the new version, production still runs the old code (old limits, consent `Yes`).
- jsPDF without SRI (F16). The CV and the sheet ID remain in git history (C8).
- Mocked tests cannot prove the live deployment works; one approved live enquiry is required (owner action D5).
