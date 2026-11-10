# Enquiry system

The contact form on `contact.html` posts to a Google Apps Script web app. Apps Script validates the enquiry, writes one row to the existing `Leads` sheet, emails the customer an acknowledgement, and emails the business owner. The page shows success only after Apps Script returns the enquiry reference.

This is not a confirmed booking. Website submissions are stored as **RECEIVED**. Only an authorised business action can change an enquiry to **CONFIRMED**.

Do not merge the live `data-enquiry-endpoint` value until the web app has been deployed and verified. Until that URL is set, the form keeps the existing mailto hand-off to `lesleysacks1@gmail.com`.

## Architecture

```
contact.html
  -> js/enquiry-form.js
  -> POST https://script.google.com/macros/s/.../exec   (hidden iframe)
  -> Apps Script doPost(e)
  -> Leads sheet
  -> customer acknowledgement email
  -> owner notification email
```

There is no Node proxy, no extra database, and no `onFormSubmit` trigger. A normal website enquiry is a `doPost` request.

Google Apps Script does not answer browser `fetch` CORS preflights for `application/json`. A `no-cors` fetch would return an opaque response that cannot prove the row was saved. The form therefore uses a native POST into a hidden iframe. `doPost` returns an `HtmlService` page with `XFrameOptionsMode.ALLOWALL` that `postMessage`s the result to `https://www.intersacks.co.za` or `https://intersacks.co.za`. The page treats the enquiry as saved only when that message includes an `ISD-` reference from a `script.googleusercontent.com` origin.

## Spreadsheet compatibility

The spreadsheet is `InterSacks – Enquiries` (`1N2xHXT2t28CdSBkZFihbOxgk9H3kK2-8n0QK2kXrW4M`). Tabs: `Leads`, `Dashboard`, `Lists`, `Error Log`.

This integration does not create another spreadsheet, does not rename tabs, and does not write to `Dashboard` or `Lists`. It writes Leads columns A–T only. Column U, `Counted`, stays under:

```
=ARRAYFORMULA(IF(A2:A="","",IF((L2:L="SPAM")+(S2:S<>"")>0,0,1)))
```

The Lists / Dashboard pipeline still uses `NEW`, `CONTACTED`, `QUALIFIED`, `QUOTED`, `WON`, `LOST`, and `SPAM`. Website enquiry statuses map onto those values so the dashboard keeps counting:

| Enquiry status | Lead status written | Who sets it |
| --- | --- | --- |
| RECEIVED | NEW | `doPost` |
| PENDING_CONFIRMATION | CONTACTED | owner, by hand or `markPendingConfirmation(reference)` |
| CONFIRMED | WON | owner, by hand or `confirmEnquiry(reference)` |
| CANCELLED | LOST | owner, by hand or `cancelEnquiry(reference)` |

`doPost` ignores any `status` field sent by the browser. It always stores RECEIVED/NEW.

Other conventions kept from the existing sheet:

- Lead source: `Website – Contact form` (en dash, Lists value)
- Priority: `Medium`
- Consent to contact: `Yes` (the visitor submitted the enquiry form)
- Duplicate protection: submission key only. A second enquiry from the same email is a new row
- Notification status is written to Internal notes after email attempts, for example `Notifications: customer=sent; owner=sent; whatsapp=disabled`

## Script properties

Project settings > Script properties:

| Name | Required | Purpose |
| --- | --- | --- |
| `SPREADSHEET_ID` | Yes | Existing spreadsheet id. If unset, the script falls back to the known production workbook |
| `SHEET_NAME` | No | Defaults to `Leads` |
| `ERROR_SHEET_NAME` | No | Defaults to `Error Log` |
| `OWNER_EMAIL` | Yes | Owner notification recipient. Never sent to the website |
| `ENVIRONMENT` | Yes | `production` or `test`. `test` skips MailApp so test runs cannot email real customers |
| `ALLOWED_ORIGINS` | No | Comma-separated origins allowed to receive `postMessage`. Defaults to the two InterSacks HTTPS origins |
| `WHATSAPP_ENABLED` | No | Must stay `false`. The WhatsApp function is a stub for a later official API |
| `BUSINESS_NAME` | No | Defaults to `InterSacks Digital` |
| `BUSINESS_EMAIL` | No | Customer-facing reply address. Defaults to the public studio email |
| `BUSINESS_PHONE` | No | Defaults to `084 325 2262` |

Do not put these values in website JavaScript.

## Deployment

Do not overwrite a live `/exec` URL until this version has been pasted, properties set, and `runSafeSelfTest` plus a controlled trial have passed.

1. Open the **existing** standalone Apps Script project for this workbook if one was already created. Do not create a second project, and do not paste this into an unrelated Client Operations project.
2. If no project exists yet, create one named `InterSacks website enquiries`, set the timezone to `Africa/Johannesburg`, and paste `apps-script/EnquiryWebApp.gs`.
3. Set the script properties above. `ENVIRONMENT=production` only when you are ready to send real customer email.
4. Deploy **Web app**. Execute as **Me**. Who has access: **Anyone**. Copy the URL that ends in `/exec`.
5. Redeploy as a **new version** after every script change. Saving the editor is not a deploy.
6. Put that `/exec` URL in `contact.html` as `data-enquiry-endpoint="https://script.google.com/macros/s/.../exec"` only after a trial submission has been verified.
7. The Google account that deploys the web app needs edit access to the spreadsheet.

### Access setting

`Anyone` with execute-as-me is required so a visitor can submit without a Google account. The web app therefore accepts public POSTs. Validation, a honeypot, a per-email courtesy limit, and LockService are the controls. Changing this to "Only myself" would stop the website form from saving. Do not change production permissions without accepting that effect.

## Frontend change

The website HTML and CSS are otherwise unchanged. The minimum JavaScript change is required because:

- `fetch` to Apps Script is blocked by CORS for JSON POSTs
- `fetch` with `no-cors` cannot prove the row was saved
- GitHub Pages cannot host a proxy
- The customer must see the enquiry reference after a confirmed save

`js/enquiry-form.js` posts the existing fields through a hidden iframe and waits for `postMessage`. If `data-enquiry-endpoint` is empty, the original mailto hand-off still runs.

## Testing

```bash
npm test
node scripts/check-seo.mjs
```

`npm test` uses an in-memory spreadsheet and a fake MailApp. It does not open Google and does not send mail.

In the Apps Script editor, `ENVIRONMENT=test` skips MailApp. `runSafeSelfTest()` validates samples without writing production rows. Do not point an experimental script at the production `Leads` tab unless that row should remain.

## Manual steps still required

1. Paste or update the existing Apps Script project. Do not create a duplicate spreadsheet.
2. Set script properties.
3. Deploy a new web-app version. Leave the previous version in place until this one is verified.
4. Run `runSafeSelfTest` in the editor.
5. Send one real enquiry only when you want that row on the production `Leads` tab.
6. Then set `data-enquiry-endpoint` on `#contact-form` and merge.
