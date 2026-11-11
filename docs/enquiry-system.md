# Enquiry system

The contact form on `contact.html` posts to a Google Apps Script web app. Apps Script validates the enquiry, writes one row to the existing `Leads` sheet, emails the customer an acknowledgement, and emails the business owner. The page shows success only after Apps Script returns the enquiry reference.

This is not a confirmed booking. Website submissions are stored as **RECEIVED**. Only an authorised business action can change an enquiry to **CONFIRMED**.

`#contact-form` now posts to the Apps Script web app URL supplied for this site:

`https://script.google.com/macros/s/AKfycbyXeYkJxc01UIhhmKTdlKQu3NQ2T5UT3Yl-jgfrwn0wqyMTDAQFMoAWANYwLDnMKheshw/exec`

The published GitHub Pages page still uses mailto until this change is merged. The form does not use `fetch` with `no-cors`, because that response cannot prove the enquiry was saved.

An anonymous request to that URL on 11 November 2026 was redirected to a Google sign-in page. The web app is not available to visitors until the deployment is set to execute as **Me** and access **Anyone**, and a new version is deployed. Until then the contact page will wait and then show a failure. It will not show a success message.

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

Google Apps Script does not answer browser `fetch` CORS preflights for `application/json`. A `no-cors` fetch would return an opaque response that cannot prove the row was saved. The form therefore uses a native POST into a hidden iframe. `doPost` returns an `HtmlService` page with `XFrameOptionsMode.ALLOWALL`. That page posts the result to each ancestor frame. The contact page treats the enquiry as saved only when the message includes an `ISD-` reference and the sender origin is `script.google.com` or `*.script.googleusercontent.com`. The posted result has no email address and no spreadsheet id. A saved row whose customer email failed is shown as saved, with the reference, and the page says the email was not sent.

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
| `SPREADSHEET_ID` | Yes for production | Existing spreadsheet id. A production submission is rejected when this is missing. There is no silent fallback |
| `SHEET_NAME` | No | Defaults to `Leads` |
| `ERROR_SHEET_NAME` | No | Defaults to `Error Log` |
| `OWNER_EMAIL` | Yes for production | Owner notification recipient. A production submission is rejected when this is missing or not an email address. Never sent to the website |
| `ENVIRONMENT` | Yes | Only the exact value `production` accepts website submissions. `test`, `development`, or a missing value returns `TEST_MODE` and does not write `Leads`, send email, or issue a reference. `runSafeSelfTest()` still runs in the editor |
| `ALLOWED_ORIGINS` | No | Kept for compatibility. The reply is accepted by the website from the Google origin, not from this list |
| `WHATSAPP_ENABLED` | No | Must stay `false`. The WhatsApp function is a stub for a later official API |
| `BUSINESS_NAME` | No | Defaults to `InterSacks Digital` |
| `BUSINESS_EMAIL` | No | Customer-facing reply address. Defaults to the public studio email |
| `BUSINESS_PHONE` | No | Defaults to `084 325 2262` |

Do not put these values in website JavaScript.

## Deployment

Do not overwrite a live `/exec` URL until this version has been pasted, properties set, and `runSafeSelfTest` plus a controlled trial have passed.

1. Open the **existing** standalone Apps Script project for this workbook if one was already created. Do not create a second project, and do not paste this into an unrelated Client Operations project.
2. If no project exists yet, create one named `InterSacks website enquiries`, set the timezone to `Africa/Johannesburg`, and paste `apps-script/EnquiryWebApp.gs`.
3. Set `SPREADSHEET_ID` and `OWNER_EMAIL`. Leave `ENVIRONMENT` as `test` until you are ready for a real row and a real email. Only the exact value `production` accepts a website submission.
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

In the Apps Script editor, `ENVIRONMENT=test` rejects website submissions before a row is written. `runSafeSelfTest()` validates samples without writing production rows or sending mail. Do not set `ENVIRONMENT=production` until `SPREADSHEET_ID` and `OWNER_EMAIL` are set and you are ready for a real row to remain.

## What is already confirmed

These values were read from the live site and the existing spreadsheet on 11 November 2026. They are not guesses.

| Item | Confirmed value |
| --- | --- |
| Live host | GitHub Pages (`server: GitHub.com`) at `https://www.intersacks.co.za/contact.html` |
| Live submit behaviour on 11 November 2026 | The published page opened `mailto:lesleysacks1@gmail.com`. This branch now sets the supplied `/exec` URL on `#contact-form` |
| Spreadsheet | `InterSacks – Enquiries`, id `1N2xHXT2t28CdSBkZFihbOxgk9H3kK2-8n0QK2kXrW4M` |
| Worksheet | `Leads`, 21 columns, header row frozen |
| Counted formula | Present in `Leads!U2`. Data columns A–T on row 2 are empty |
| Lists statuses | `NEW`, `CONTACTED`, `QUALIFIED`, `QUOTED`, `WON`, `LOST`, `SPAM` |
| Public studio email | `lesleysacks1@gmail.com`, already printed on the contact page |

The owner supplied the web app URL now stored on `#contact-form`. The deployment version and script properties still have to be confirmed in the Apps Script dashboard. The published contact page does not use this URL until the change is merged.

## Safe verification procedure

Do not send a production enquiry until you approve that the row may remain on `Leads`.

1. Paste the script into the existing project, or create one project only if none exists. Set `ENVIRONMENT=test`, plus `SPREADSHEET_ID` and `OWNER_EMAIL`.
2. Run `runSafeSelfTest()` in the editor. It does not write a lead or send mail.
3. Deploy a new web-app version: execute as **Me**, access **Anyone**. Authorise Sheets and Mail when Google asks. A website POST while `ENVIRONMENT` is `test` must return `TEST_MODE` and must not add a `Leads` row.
4. Approve one clearly labelled trial, then set `ENVIRONMENT=production` and submit once from the deployed `/exec` URL with a name such as `TEST ENQUIRY — DELETE IF NOT NEEDED`.
5. Confirm exactly one new `Leads` row, an `ISD-` reference, an owner email, and a customer email. Confirm the row status is `NEW` and the notes show `customer=sent; owner=sent`.
6. The supplied `/exec` URL is already on `#contact-form`. Publish the website only after the trial row, reference, and both emails are confirmed.

`npm test` is a simulated in-memory run. A passing mock is not evidence that the live website, spreadsheet, or email delivery works.

## Manual steps still required

1. Paste or update the existing Apps Script project. Do not create a duplicate spreadsheet.
2. Set script properties.
3. Deploy a new web-app version. Leave the previous version in place until this one is verified.
4. Run `runSafeSelfTest` in the editor.
5. Send one real enquiry only when you want that row on the production `Leads` tab.
6. Merge and publish only after that trial. `#contact-form` already has the supplied `/exec` URL.
