# Release 1 — Privacy review (POPIA, technical)

This is a technical implementation and documentation review against the Protection of Personal Information Act, 2013 (POPIA). **It is not legal advice and not a compliance certification.** The site does not claim to be "POPIA compliant". Owner inputs are listed in `RELEASE_1_OWNER_ACTIONS.md`.

## 1. What personal information the site actually processes (verified in code)

| Channel | Data | Where it goes | Code |
|---|---|---|---|
| Contact form | Name, email, phone, optional business, service, message; page path; submission time; form-open duration; privacy-notice version; optional marketing choice; random submission key | Google Apps Script (runs as the owner) → one row in the owner's Google Sheet; owner notification email; customer acknowledgement email (Gmail/MailApp) | `contact.html`, `js/enquiry-form.js`, `apps-script/EnquiryWebApp.gs` |
| Email, phone and WhatsApp links | Whatever the visitor sends | The visitor's own app → the owner's inbox, phone or WhatsApp | `mailto:`, `tel:`, `wa.me` links |
| Google Analytics 4 | Page path, event name, link area, service name; Google's technical data (IP, device, browser); cookies | Google, measurement ID `G-XCN1MN0GHR`, production host only | `js/analytics.js` |
| Browser tools (quote, invoice, job card) | Typed into the page; stays in the browser | Nowhere (PDF generated locally) | `assets/*.html` |
| WhatsApp order builder | Order details | Only to WhatsApp, if the visitor chooses "Open WhatsApp" | `assets/whatsapp_order_builder.html` |

No enquiry field, reference or contact detail is sent to Google Analytics (tested).

## 2. Lawful processing and consent

**Finding (verified):** the backend wrote `Consent to contact = Yes` for every web enquiry, although the form had no consent control.

**Assessment.** Replying to an enquiry the person themselves sent is processing that the person requested. Consent is not the only possible basis under POPIA section 11. Section 11(1) also lists, among others, processing needed to take steps at the data subject's request towards a contract, and processing for a legitimate interest. Recording a "consent" that was never asked for is weak evidence and misdescribes what happened. Marketing is a different purpose and needs its own choice.

**What changed:**

| Purpose | How it is handled now |
|---|---|
| Reply to the enquiry, prepare a quote, keep a record | No checkbox. A notice beside the submit button explains the purpose and links to `privacy.html#enquiries`. Column K records `Reply to enquiry only (visitor request)`. |
| Optional marketing (news and offers) | A separate, **unticked, optional** checkbox. Not required to send an enquiry (tested). Only the exact value `yes` counts. Column K records `Reply to enquiry + marketing opt-in` when ticked. |
| Future promotional contact | Only for people whose row shows the marketing opt-in. They can withdraw by email (notice §Your rights). Owner decision C2: if marketing is not wanted, remove the box. |
| Service providers (operators) | Google (Apps Script, Sheets, Gmail, Analytics), disclosed in the notice, including possible processing outside South Africa |

**Evidence stored** (Internal notes, column Q), for example:
`Privacy notice 2026-11-21 shown on form; Submitted 2026-11-21T10:15:00+02:00; Purpose: reply to this enquiry; Marketing opt-in: no; Form timing: ok`

Existing rows are not changed. Older rows keep `Yes`, which reflects the previous form. The owner may wish to treat those as "reply only".

## 3. Privacy notice changes (`privacy.html`)

The notice previously covered analytics well but enquiries only briefly. It now also explains:

- who is responsible, with owner placeholders A1–A2;
- what the form collects, including the technical fields;
- why it is used, and that sending the form is not a marketing sign-up;
- how an enquiry is processed (Apps Script → Sheets → two emails; repeats);
- who receives it (InterSacks Digital; Google as service provider; possible cross-border processing);
- how long it is kept (placeholder A3, with the tax-record exception);
- how it is protected, without overstating ("No method … is completely secure");
- rights to access, correction, deletion, objection and withdrawal, and how to ask (placeholder A4 for the response time);
- security incidents: notification as POPIA requires;
- complaints to the Information Regulator (link only; no contact details invented);
- GA4: the correct ID, `generate_lead`, Google signals off, and the unchanged cookie guidance;
- other services the pages load: Google Fonts, cdnjs for the tools, and the session-only loader note.

The automated checks still fail on "we comply", "POPIA compliant", "fully compliant", "cookies are disabled" and "consent mode". They no longer forbid explaining *why* data is processed.

## 4. Third-party technologies

| Technology | Category | Cookies or storage | Notes |
|---|---|---|---|
| Google Apps Script, Sheets, Gmail | Essential for the enquiry service | None set on the website | Operator for enquiry data |
| Google Fonts (fonts.googleapis.com / gstatic) | Presentation | No cookies; the request reveals IP to Google | Not disclosed before; **now disclosed** in `privacy.html#other-services`. Self-hosting fonts would remove this (Release 2 candidate). |
| Google Analytics 4 | Analytics | `_ga`, `_ga_<id>` cookies | Disclosed. No opt-in control. Google signals and ad personalisation are now off in the tag. **Owner decision C3** on consent. |
| cdnjs (jsPDF) on tool pages | Functionality | None | No SRI (security report F16) |
| WhatsApp (`wa.me`) | Contact | Only when the visitor clicks | Disclosed in the notice |
| `sessionStorage` key `intersacks-loader-shown` | Essential UI (show the homepage loader once) | Session only, no personal data | Strictly functional |

No cookie banner was added. A banner that did not change what the tag collects would be misleading. If the owner chooses opt-in analytics (C3), implement Google Consent Mode with a control that really gates the tag.

## 5. Retention

**Current situation (verified):** there is no retention rule. Rows stay in the sheet indefinitely, and the Error Log grows without limit (it holds no personal data).

**Proposal for the owner (decision C1; nothing was deleted):**

| Record | Proposed retention |
|---|---|
| Enquiries that did not lead to work (status NEW, CONTACTED, QUALIFIED, QUOTED, LOST, SPAM) | 24 months after the last contact |
| Enquiries that led to paid work | As long as accounting and tax law requires (often five years under the Tax Administration Act; confirm with an accountant) |
| Marketing opt-in | Until withdrawn, then remove the opt-in (keep the enquiry under the rule above) |
| Error Log rows | 12 months |

**Manual procedure (quarterly), until an automated job is approved:**
1. Open the sheet, filter `Date received` older than the retention date, and exclude rows linked to paid work.
2. Export nothing. Delete those rows (whole row). The `Counted` formula in column U adjusts automatically.
3. Delete Error Log rows older than 12 months.
4. Note the date of the review in a private log.

Automated deletion was **not** implemented. Deleting customer records automatically is irreversible and needs the owner's decision on the period and on which statuses are exempt.

## 6. Data-subject requests (process for the owner)

1. Receive the request by email. Verify the requester, for example by replying from the address on the enquiry.
2. Find rows by email or reference (`ISD-…`).
3. Access: send the row's contents. Correction: edit the row. Deletion: delete the row, unless it must be kept for tax records. Marketing withdrawal: change column K to `Reply to enquiry only (visitor request)` and add a note.
4. Reply within the period you set (A4).

## 7. Security incidents

If the Google account, sheet or inbox is compromised: secure the account (password, 2-step verification, revoke sessions); identify the affected rows; notify the Information Regulator and affected people as soon as reasonably possible (POPIA section 22); keep a record. Ensure 2-step verification is enabled on the owner's Google account (recommended; not verifiable from here).

## 8. Limitations

- No legal review. Placeholders A1–A4 must be completed.
- The live Apps Script still writes `Yes` until the new version is deployed.
- Historical rows keep `Yes` in column K.
- GA4 cookies are set without opt-in (decision C3).
