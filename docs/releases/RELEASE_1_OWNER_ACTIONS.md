# Release 1 — Owner actions

Branch: `feature/release-1-security-compliance`. Nothing has been merged, deployed, or sent to the live Apps Script. Everything below needs the business owner: a decision, information only the owner has, or access to the owner's Google account.

Run `npm run check:release` before merging. It fails until the privacy-notice placeholders below are replaced.

## A. Information to provide (blocks publishing the privacy notice)

These placeholders are visible on `privacy.html` in this branch. Replace each with the real value, or ask for the sentence to be reworded.

| # | Placeholder text in `privacy.html` | What is needed | Why |
|---|---|---|---|
| A1 | `[OWNER TO CONFIRM: registered or trading name of the responsible party]` | The legal name InterSacks Digital operates under: a sole proprietor's own name, or a registered company name and registration number | POPIA's notice requirements (section 18) include the name of the responsible party |
| A2 | `[OWNER TO CONFIRM: name of the Information Officer, and whether a deputy is appointed]` | Who the Information Officer is. For a sole proprietor this is normally the owner; for a company, the head of the company unless someone else is authorised. State whether the Information Officer is registered with the Information Regulator | The notice tells people who handles access and complaint requests |
| A3 | `[OWNER TO CONFIRM: retention period, for example 24 months after the last contact]` | How long enquiry rows are kept (see C1) | Section 14 says records must not be kept longer than necessary |
| A4 | `[OWNER TO CONFIRM: target response time for requests]` | For example "within 30 days". PAIA and POPIA set formal time limits; ask a legal adviser for the right wording | Sets expectations for access and correction requests |

No address, registration number, Information Officer name or retention period has been invented. The wording of `privacy.html` has not been reviewed by a lawyer. Have it reviewed before relying on it. This release does **not** make the site "POPIA compliant", and the site does not claim that it does.

## B. Google account checks (cannot be done from the repository)

| # | Check | Where |
|---|---|---|
| B1 | Confirm the worksheet name. The script writes to the tab named by the `SHEET_NAME` script property (default `Leads`). The owner described the tab as `Enquiries`. If `SHEET_NAME` is already `Enquiries`, nothing changes. Do not rename tabs. | Apps Script → Project settings → Script properties |
| B2 | Confirm **column K (`Consent to contact`)** can hold the new values `Reply to enquiry only (visitor request)` and `Reply to enquiry + marketing opt-in`. If the `Lists` tab or a data-validation rule only allows `Yes`/`No`, or the `Dashboard` counts `Yes` in column K, say so before deploying. The script can be changed to another wording. | Google Sheets → Leads → column K → Data validation; Dashboard formulas |
| B3 | Confirm the spreadsheet is **not** shared as "Anyone with the link". Its ID is published in this public repository (and in git history), so its sharing setting is the real protection. | Google Sheets → Share |
| B4 | After deployment, confirm in **GA4 → Realtime** that page views still arrive on `G-XCN1MN0GHR`. The new Content Security Policy follows Google's published host list, but the Google tag could not be loaded from this test environment. | GA4 |
| B5 | Mark `generate_lead` as a **key event** once it first appears. | GA4 → Admin → Events |
| B6 | Confirm `G-XCN1MN0GHR` is the active web stream. The branch keeps the ID the site already sends to, as the owner identified. | GA4 → Admin → Data streams |

## C. Decisions

| # | Decision | Options and recommendation |
|---|---|---|
| C1 | **Enquiry retention period** | Proposal: delete enquiries that did not become work **24 months after the last contact**; keep records of paid work for as long as tax law requires (often five years under the Tax Administration Act; confirm with your accountant); clear the `Error Log` after 12 months. See `RELEASE_1_PRIVACY_REVIEW.md` §5 for the manual procedure. Nothing is deleted automatically. |
| C2 | **Do you want to send marketing at all?** | If not, remove the optional marketing checkbox before publishing (one `<label>` in `contact.html`). If yes, keep a list of who opted in (filter column K), honour withdrawals, and include an opt-out in every marketing message. |
| C3 | **Analytics and consent** | GA4 sets cookies without asking first. POPIA has no cookie-specific rule, and whether opt-in consent is needed for analytics is a legal judgement. Options: (a) keep as now, with the disclosure; (b) add Google Consent Mode with a real opt-in banner (a separate, larger change). No banner was added for appearance only. |
| C4 | **Global hourly limit** | Default 30 saved enquiries per hour across the whole web app. A flood above it also blocks genuine visitors for that hour, who see the phone and WhatsApp number. Lower it to protect mail quota, raise it if you expect bursts. Script property `GLOBAL_HOURLY_LIMIT`. |
| C5 | **Turn on `REQUIRE_FORM_TIMING=true`** after the Release 1 website is live | Makes the bot check mandatory. Leave it `false` until the new `contact.html` is published. |
| C6 | **CAPTCHA (Cloudflare Turnstile or reCAPTCHA)** | Not added. It would bring in a third-party service, which needs approval. It is the next step if spam gets through the current controls. |
| C7 | **Security headers that GitHub Pages cannot send** (`X-Frame-Options`/`frame-ancestors`, `X-Content-Type-Options`, `Permissions-Policy`, a header-based CSP) | Needs a CDN or proxy in front of the site (for example Cloudflare) or a host that supports headers. Optional; see the security report. |
| C8 | **Git history** still contains the removed CV and the spreadsheet ID | Rewriting public history is disruptive and does not remove copies already cloned or cached. Recommendation: leave the history, rely on B3, and treat the CV as already disclosed. Say if you want a history rewrite. |

## D. Deployment (only after approval)

The website and the Apps Script can be deployed in either order. Each works with the other's old version:

- The **old** Apps Script ignores the new form fields (`formElapsedMs`, `privacyNotice`, `marketingConsent`). Until the script is updated it still writes consent as `Yes`.
- The **new** Apps Script accepts the old form, because a missing `formElapsedMs` is allowed while `REQUIRE_FORM_TIMING` is not `true`.

Recommended order:

1. Replace the placeholders (A) and run `npm test` and `npm run check:release`.
2. Merge the branch to `main`. GitHub Pages publishes the website.
3. In the **existing** Apps Script project, paste `apps-script/EnquiryWebApp.gs` and save. Then **Deploy → Manage deployments → edit the existing web app deployment → New version**. Editing the existing deployment keeps the `/exec` URL the same. Creating a new deployment would change the URL, and `contact.html` would no longer match it.
4. Run `runSafeSelfTest()` in the editor. Every result should pass. It writes nothing and sends nothing.
5. **With your approval**, send one clearly labelled real enquiry on the live site, for example name `TEST ENQUIRY RELEASE 1 — DELETE`. Confirm: one new row with an `ISD-` reference; column K shows the new wording; Internal notes show the privacy-notice evidence; the owner email arrives first, then the customer email; GA4 Realtime shows `generate_lead`. Then delete the row.
6. Set `REQUIRE_FORM_TIMING=true` (C5).

To roll back the website, revert the merge. To roll back the script, select the previous version in Manage deployments.
