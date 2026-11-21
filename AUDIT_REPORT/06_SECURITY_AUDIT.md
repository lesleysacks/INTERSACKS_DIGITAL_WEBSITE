# 06 — Security, Privacy and Business-Integration Audit (Phase 7)

No credentials or secret configuration values are reproduced in this report. The spreadsheet ID and Apps Script deployment ID are already public in the repository. They are deliberately not repeated here.

## 6.1 Can the enquiry process capture a lead, give feedback and notify the business?

```
contact.html form ──(native POST into hidden iframe)──► Apps Script /exec doPost
     ▲                                                   │ validate → lock → dedupe → rate-limit
     │ postMessage {ok, reference}                       │ write Leads A–T (status NEW)
     └──────────── HtmlService page ◄────────────────────┤ MailApp → customer ack
                                                         │ MailApp → owner (OWNER_EMAIL)
                                                         └ write notification status to notes
```

| Step | Code-level verdict | Production verdict |
|---|---|---|
| Client validation | **Verified locally** (Playwright: empty form and bad phone blocked, no network POST) | – |
| POST reaches Apps Script anonymously | Code correct. `appsscript.json` = `ANYONE_ANONYMOUS`. | **UNVERIFIED.** `docs/enquiry-system.md` records that on 11 Nov 2026 anonymous requests were **redirected to Google sign-in**. The *deployed* access setting lives in Google, not in the repo. |
| `ENVIRONMENT=production`, `SPREADSHEET_ID`, `OWNER_EMAIL` set | Gate is correct: otherwise it returns `TEST_MODE`/`CONFIG` and the UI shows an error | **UNVERIFIED** (script properties are only visible in Google) |
| Lead saved to the Sheet | Mock-tested (tests 1, 6, 9, 9b, 14) | **UNVERIFIED** |
| Customer gets an acknowledgement with reference | Mock-tested (12). UI shows the reference. | **UNVERIFIED** |
| Business notified at the intended address (`lesleysacks1@gmail.com`) | Sent to the `OWNER_EMAIL` property. The default fallback `BUSINESS_EMAIL` is the same address. | **UNVERIFIED.** Confirm that `OWNER_EMAIL` holds the intended address. |
| Failure feedback | 20 s timeout → "We could not send your enquiry… email/call" with alternatives. Good. | – |
| Alternative channels if the form fails | Phone, email and WhatsApp are on the same page. Good. | Links verified |

**Conclusion:** the design *can* reliably capture, confirm and notify. **Whether it does so today cannot be determined from the repository.** If the 11 Nov deployment state persists, **every form enquiry fails** (the visitor sees an error after 20 s, but at least has fallbacks). This is the single most important item for the owner to verify. See P0-1 in 09.

## 6.2 Findings

| ID | Finding | Evidence | Risk | Priority |
|---|---|---|---|---|
| S1 | **Acknowledgement email sent to any address submitted; no CAPTCHA** | `sendCustomerAcknowledgement` → `MailApp.sendEmail({to: record.email})`. Rate limit `RATE_LIMIT_PER_HOUR=20` is keyed **by email**, so rotating addresses bypasses it. The only bot control is a honeypot. | A bot can make the owner's Google account send hundreds of "We received your enquiry" emails to victims (the attacker controls `name`, which is shown in the greeting). Consumer Gmail MailApp quota is about 100 recipients/day. Once exhausted, **owner notifications fail** (the lead still saves; notes show `owner=failed`). Spam complaints can harm the account's reputation. | **P1** |
| S2 | **Consent hard-coded** | `saveEnquiry` writes `'Yes'` to "Consent to contact". There is no checkbox and no privacy link at the form. | POPIA requires processing to be lawful and the data subject to be informed. A recorded "consent" that was never captured is weak evidence. | **P1** |
| S3 | **GA4 ID mismatch and no lawful-basis statement** | Code `G-XCN1MN0GHR`. Privacy page `G-Q85HJEHCZ7`. `docs/analytics.md` admits "The business still needs a lawful basis under POPIA". `check-seo.mjs:136` **fails the build if the privacy page mentions "lawful basis" or "consent mode"**. | Inaccurate disclosure. Possibly lost analytics. The test blocks a compliance fix. | **P0** (accuracy) / P1 (POPIA) |
| S4 | **Personal CV publicly served** | `assets/L.S CV 2026.pdf` (157 KB), `.docx`. Not linked, but reachable by URL and indexable if discovered. Contains personal contact data. | Personal data exposure; scraping | **P1** |
| S5 | Spreadsheet ID in a public repo | `.gs` constant + `docs/enquiry-system.md` | Not exploitable alone. Becomes exploitable if the Sheet is ever shared "anyone with link". | P2. Owner: verify the Sheet's sharing. Move the ID out of docs. |
| S6 | Third-party script without SRI | jsPDF 2.5.1 from cdnjs on 3 tool pages | Supply-chain risk on those pages | P2 |
| S7 | No Content-Security-Policy | GitHub Pages cannot set headers. No `<meta http-equiv="Content-Security-Policy">`. | Defence in depth only (there is no user-generated HTML) | P3 |
| S8 | `postMessage(payload, "*")` | `createHtmlResponse` | Payload is non-sensitive (reference, status, key). The receiver checks the origin. **Acceptable** as documented. | – |
| S9 | Owner email body | Plain text plus escaped HTML, `<pre>` for message | Injection handled. Good. | – |
| S10 | Formula and header injection | `asText_`, `formulaPrefix_`, `safeHeader_`, tested | Good | – |
| S11 | No exposed secrets | `.env.example` contains placeholders only. `.env` is git-ignored. No API keys in JS. | Good | – |
| S12 | External links | All `target="_blank"` links include `rel="noopener noreferrer"` (spot-checked across Work, Services, footer) | Good | – |
| S13 | `ALLOWED_ORIGINS` not enforced server-side | Any site could POST to `/exec` | Inherent to Apps Script (it has no reliable Origin header). Mitigate with S1 controls. | – |
| S14 | Dormant payment functions | Netlify functions accept a custom amount (per `PAYMENTS.md`) | Not deployed on Pages. Risk only if someone deploys to Netlify. | P2 (remove or isolate) |

## 6.3 Privacy policy and disclosures

- The privacy page is **specific and honest** about GA4, its events and cookie management. That is unusually good.
- **Gaps:** wrong measurement ID. No POPIA Information Officer or contact role. No retention period for enquiry data held in the Sheet. No statement of operator (Google) or cross-border transfer. No right of access/correction/objection, or how to exercise it. No consent mechanism for analytics.
- **Recommendation:** add a short "Your enquiry data" and "Your rights under POPIA" section. Add a required consent checkbox linked to it. Consider GA4 Consent Mode v2 with a simple, *functional* banner. The repo docs rightly say a banner that does nothing would be misleading. Relax the `check-seo.mjs` rule that forbids this wording. Legal wording should be reviewed by a qualified person; this audit is not legal advice.

## 6.4 Recommended hardening for the enquiry endpoint (no architectural change)

1. **Cloudflare Turnstile** (free) or reCAPTCHA v3 token in the form, verified in `doPost` with `UrlFetchApp`. The secret goes in Script Properties.
2. **Global rate limit**: `CacheService` counter per hour across all submissions, for example 30/h. Above it, save the lead but **skip the customer email**.
3. **Send the owner notification first**, so the quota is spent on the business before the customer.
4. Keep the customer acknowledgement minimal and do not echo `name` in the subject.
5. A daily summary trigger (time-driven) that emails the owner any rows where `owner=failed`.
