# Release 1 — Enquiry hardening

The enquiry journey the owner verified on the live site (row saved, owner notified, customer acknowledged with a reference) is preserved. The same Google Apps Script, the same spreadsheet and columns A–T, the same `/exec` URL, the same hidden-iframe and `postMessage` protocol, and the same visitor messages are kept. All 42 original tests pass unchanged.

## 1. Journey before and after

```
contact.html ── POST (hidden iframe) ──► Apps Script doPost
                                         1. pickFields_        allowlist, size cap          NEW
                                         2. validateEnquiry    sanitise, strict email,
                                                               timing check                 HARDENED
                                         3. submissionGate_    production + config          unchanged
                                         4. lock → saveEnquiry
                                              key duplicate → original reference            unchanged
                                              repeat (24 h) → row with Duplicate of         NEW
                                              checkRateLimits_ email/phone/global           NEW
                                              write row (consent evidence)                  CHANGED
                                         5. notify owner (first)                            REORDERED
                                         6. acknowledge customer (budgeted, fixed template) HARDENED
                                         7. status → Internal notes                         unchanged
            ◄── postMessage {ok, reference} ──
js/enquiry-form.js → success text (unchanged) → "intersacks:lead-confirmed" → GA4 generate_lead  NEW
```

## 2. Changes by file

### `apps-script/EnquiryWebApp.gs`

| Area | Change | Why |
|---|---|---|
| Accepted fields | `ACCEPTED_FIELDS` + `pickFields_` for both form and JSON bodies. Removed `status`, `bookingDate`, `booking_date`, `bookingDetails`, `booking_details`. Added `formElapsedMs`, `marketingConsent`, `privacyNotice`. | Unexpected fields can never reach the sheet, an email or a status. Booking fields were not on the form and carried attacker text into emails. |
| Request size | More than 20,000 characters is rejected with the generic validation message | Bounds work per request |
| Text | `cleanText_`: NFC normalisation, removes C0/C1 controls, soft hyphen, bidi overrides and isolates, zero-width and other invisible format characters; collapses whitespace; truncates per field | Spoofing and hidden text; consistent storage |
| Email | `isEmail_` / `EMAIL_PATTERN`: one plain ASCII address with an alphabetic TLD; no quotes, commas, semicolons, spaces, angle brackets or line breaks; local part ≤ 64, total ≤ 254. The raw value must equal the cleaned value. | Prevents recipient lists, display names and header tricks |
| Form timing | `formTiming_`: when `formElapsedMs` is present it must be 3,000 ms – 24 h. If absent it is allowed (old website) unless `REQUIRE_FORM_TIMING=true`. | Bot deterrent. Visitor message: "Please take a moment to review your enquiry and try again." |
| Repeats | `findRecentRepeat_`: same email, service and message within 24 h → saved with `Duplicate of` = first reference; owner told "Repeat of earlier enquiry"; no customer acknowledgement (`customer=skipped:repeat`) | Predictable; uses the sheet's existing `Duplicate of` column and `Counted` formula |
| Rate limits | `checkRateLimits_`: fixed hourly windows — email 5, phone 5, global 30 (`GLOBAL_HOURLY_LIMIT`). The global limit has a message naming the phone and WhatsApp number. | Not only per email; Apps Script cannot see IP addresses |
| Notifications | `dispatchNotifications_`: owner first, then customer | Owner mail cannot be starved |
| Customer email | Re-checks that the recipient equals the validated enquiry address; `customerEmailBudget_` skips it above `CUSTOMER_EMAIL_HOURLY_LIMIT` (15) or when `MailApp.getRemainingDailyQuota()` ≤ `OWNER_MAIL_RESERVE` (20) → `customer=skipped:limit`; `greetingLine_` uses the name only if it matches a plausible-name pattern | Email abuse; no relayed spam text |
| Retries | `notificationRetryPlan_` + `claimRetry_`: a repeated submission key retries **only failed** channels, at most 2 times per key per hour; never re-sends sent or skipped mail | Replay cannot multiply mail |
| Consent | Column K: `Reply to enquiry only (visitor request)` or `Reply to enquiry + marketing opt-in`; `consentNotes_` writes the evidence to column Q | No automatic `Yes` |
| Formula prefix | `formulaPrefix_` also treats a leading tab or CR as dangerous | Defence in depth (whitespace is also collapsed) |
| Self-test | `runSafeSelfTest` gains 5 checks (address list, display name, control chars, greeting, marketing default) | Verifiable in the editor without saving |

Unchanged by design: `KNOWN_SPREADSHEET_ID` safety pin, `LEAD_HEADERS`, the column A–T layout (U stays a formula), `doGet`, the HTML/JSON response format, `publicPayload_`, `confirmEnquiry`/`cancelEnquiry`/`markPendingConfirmation`, the TEST_MODE gate, and the WhatsApp stub.

### `contact.html`
- Hidden `privacyNotice` (`2026-11-21`) and `formElapsedMs`.
- Optional, unchecked marketing checkbox (`value="yes"`, not required).
- Privacy summary linking to `privacy.html#enquiries`; the form's `aria-describedby` includes it.
- Cache-busting `?v=release-1` on `styles.css` and `enquiry-form.js`.
- CSP and referrer meta (all site pages).

### `js/enquiry-form.js`
- Records page-load time and writes `formElapsedMs` at submit. There is no client-side block, so the server decides.
- Client email check mirrors the server rule.
- After a trusted, referenced, non-duplicate success, calls `onLeadConfirmed`, by default dispatching `intersacks:lead-confirmed` with `{reference, service}`, **once per reference**. A timeout, error, TEST_MODE, untrusted origin, wrong key, missing reference or duplicate never fires it (tested). The visible success and failure messages are unchanged.

### `js/analytics.js`
- Listens for `intersacks:lead-confirmed` and sends `generate_lead` once per reference with `link_location: contact` and an allowlisted `service_name`. The reference and contact details are not sent.
- `config` sets `allow_google_signals: false`, `allow_ad_personalization_signals: false`.
- Measurement ID unchanged: `G-XCN1MN0GHR`.

### `css/styles.css`
- Styles for the consent checkbox and privacy summary; `h3` and underlined links in the privacy notice.

## 3. Script properties (new; all optional)

| Property | Default | Notes |
|---|---|---|
| `GLOBAL_HOURLY_LIMIT` | 30 | Saved enquiries per hour, whole web app |
| `CUSTOMER_EMAIL_HOURLY_LIMIT` | 15 | Acknowledgements per hour |
| `OWNER_MAIL_RESERVE` | 20 | MailApp quota kept for owner notifications |
| `REQUIRE_FORM_TIMING` | `false` | Set `true` after the Release 1 website is live |

## 4. Compatibility

- **Existing rows** are untouched. Retry logic reads old notes (`Notifications: …`) correctly. Rows written before Release 1 keep `Yes` in column K.
- **Spreadsheet schema** is unchanged. Column S (`Duplicate of`) is now used, as the existing `Counted` formula expects.
- **Old website + new script:** works (timing absent is allowed; marketing absent = no).
- **New website + old script:** works (old script ignores the new fields).
- **Possible owner-side conflict:** a data-validation rule or dashboard formula on column K expecting `Yes`/`No` (owner action B2).

## 5. Limitations

- No IP-based limiting is possible in Apps Script. Distributed abuse can reach the global cap.
- The timing check and honeypot stop naive bots only.
- CacheService counters are best-effort and can be evicted.
- MailApp quota figures depend on the Google account type and are read at run time.
- The live Apps Script is **not** updated. That needs the owner's deployment (owner actions D3–D5).
