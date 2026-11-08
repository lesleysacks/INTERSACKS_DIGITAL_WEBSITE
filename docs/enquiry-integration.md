# Website enquiry integration

The contact form on `contact.html` sends an enquiry to a small Node proxy. The proxy checks the request and forwards it to a standalone Google Apps Script web app. Apps Script writes one row to the `Leads` sheet and returns JSON. The page shows a success message only after that response includes a lead id.

Nothing in this repository deploys the Apps Script or points the live website at it. `www.intersacks.co.za` is served by GitHub Pages, which cannot run the proxy. Do not merge this flow to `main` until the proxy is hosted and the form can reach it. Until then, publishing the branch replaces the old email hand-off with a form that cannot save.

## Architecture

```
contact.html
  -> js/enquiry-form.js
  -> POST /api/enquiry          (or the URL in data-enquiry-endpoint)
  -> server/enquiry-server.mjs
  -> Apps Script doPost
  -> Leads sheet
```

Confirmed hosting, inspected on 8 November 2026:

- `https://www.intersacks.co.za` responds with `server: GitHub.com`.
- DNS for `www.intersacks.co.za` is a CNAME to `lesleysacks.github.io`.
- GitHub Pages builds the `main` branch from the repository root.
- `netlify/functions` and `netlify.toml` belong to the payment checkout. `PAYMENTS.md` still describes creating a Netlify site. Those functions are not what serves the public website, so the enquiry proxy is not a Netlify function.

The browser does not receive the Apps Script URL or the shared token. A `no-cors` request is not used, because an opaque response cannot prove the lead was saved.

## What the sheet already does

The spreadsheet is `InterSacks – Enquiries` (`1N2xHXT2t28CdSBkZFihbOxgk9H3kK2-8n0QK2kXrW4M`). The tabs are `Leads`, `Dashboard`, `Lists` and `Error Log`. This integration does not rename those tabs and does not write to `Dashboard` or `Lists`.

`Leads` column U, `Counted`, is an array formula:

```
=ARRAYFORMULA(IF(A2:A="","",IF((L2:L="SPAM")+(S2:S<>"")>0,0,1)))
```

A new row is counted when its lead id is present, its status is not `SPAM`, and `Duplicate of` is blank. The script writes columns A–T only. It does not write `TRUE` into column U, because a value there blocks the formula and the dashboard totals.

The dashboard counts status `NEW` and the source value from `Lists`. New website leads are therefore stored as:

| Column | Value |
| --- | --- |
| Lead source | `Website – Contact form` (the Lists value, with an en dash) |
| Lead status | `NEW` |
| Priority | `Medium` |
| Assigned person, last contacted, follow-up date, internal notes | blank |
| Duplicate of | blank |
| Consent to contact | `Yes` |

`Medium` is the middle value on the Lists tab (`Low`, `Medium`, `High`). The Lists tab has no `Normal` priority. `Website` and `New` would not match the dashboard formulas.

Duplicate handling already on the sheet is the `Duplicate of` column. A non-empty value makes `Counted` return 0. This integration does not fill that column from a matching email address or phone number. A person can send more than one enquiry. The submission key is the only idempotency check: the same key returns the original lead id and does not add or change a row.

`Error Log` headers, confirmed from the sheet, are:

`Timestamp`, `Code`, `Stage`, `Lead ID`, `Detail (no personal data)`

The script appends those five columns and skips logging if the headers differ. Details are fixed phrases. Email addresses, phone numbers and the spreadsheet id are not written there.

## 1. Create the Apps Script

Use a new standalone project. Do not open or replace an existing Client Operations project, and do not rename its functions.

1. Open [script.google.com](https://script.google.com) and create a standalone project named `InterSacks website enquiries`.
2. Set the project timezone to `Africa/Johannesburg`.
3. Replace the default file with the contents of `apps-script/EnquiryWebApp.gs`. `apps-script/appsscript.json` records the same timezone and web-app access for a `clasp` deploy; the paste deploy does not need that file.
4. The script contains the production spreadsheet id and opens it with `SpreadsheetApp.openById`. It does not call `getActiveSpreadsheet()`.
5. Open **Project settings > Script properties** and add `ENQUIRY_PROXY_TOKEN`. The value must be at least 16 characters, random, and the same value as `ENQUIRY_PROXY_TOKEN` on the proxy. If the property is missing, every submission is rejected.
6. Deploy **Web app**. Execute as **Me**. Who has access: **Anyone**. Copy the URL that ends in `/exec`.
7. The Google account that deploys the web app needs edit access to the spreadsheet. The header row is protected with a warning only, so the script can still append a lead.

Redeploy as a new version after every script change. An existing `/exec` URL does not pick up saved code until you deploy a new version.

Check that the spreadsheet timezone is `Africa/Johannesburg` so the monthly dashboard buckets match the lead-id date. This repository does not change that setting.

## 2. Configure the proxy

The proxy reads these variables from the environment. Do not commit real values. `.env.example` lists the names.

| Variable | Purpose |
| --- | --- |
| `APPS_SCRIPT_ENQUIRY_URL` | The web app `/exec` URL from the deploy step. |
| `ENQUIRY_PROXY_TOKEN` | Same secret as the Apps Script property `ENQUIRY_PROXY_TOKEN`. |
| `ENQUIRY_ALLOWED_ORIGINS` | Comma-separated browser origins. Defaults to `https://www.intersacks.co.za` and `https://intersacks.co.za` when unset. |
| `PORT` | Optional. Defaults to `8787`. |
| `ENQUIRY_BIND` | Optional. Defaults to `127.0.0.1`. Use `0.0.0.0` behind a reverse proxy. |
| `ENQUIRY_TRUST_PROXY` | Optional. Set to `true` only when a trusted proxy sets `X-Forwarded-For`. |

Start it with:

```bash
export APPS_SCRIPT_ENQUIRY_URL='https://script.google.com/macros/s/DEPLOYMENT_ID/exec'
export ENQUIRY_PROXY_TOKEN='paste-the-same-long-random-string'
export ENQUIRY_ALLOWED_ORIGINS='https://www.intersacks.co.za,https://intersacks.co.za'
node server/enquiry-server.mjs
```

The process serves `POST /api/enquiry`. It adds the token to the JSON body, follows the Apps Script redirect, and returns `{ "ok": true, "leadId": "ISD-..." }` only when Apps Script confirms the write. Apps Script itself usually answers HTTP 200 for both success and failure, so the proxy reads the JSON `ok` field.

Put the proxy on a host you control. Two layouts work:

- Serve the website and this Node process on one origin, and leave the form endpoint as `/api/enquiry`. GitHub Pages cannot do this by itself.
- Keep the website on GitHub Pages and host only the proxy elsewhere. Set `data-enquiry-endpoint` on `#contact-form` to the proxy's public `https` URL, and add that site origin to `ENQUIRY_ALLOWED_ORIGINS`.

A cross-origin browser `POST` sends a preflight. The proxy answers `OPTIONS` for an allowed origin.

Choose the host before merging. Moving the whole site, or putting another service in front of GitHub Pages, is an infrastructure change and is not done here.

## 3. Form behaviour

`contact.html` keeps the existing fields, the email address, the phone number and the WhatsApp link. It adds:

- a required consent checkbox
- a link to `privacy.html`
- a polite live region for sending, success and failure
- a disabled button and a spinner while the request is in flight

The button ignores further clicks until the request finishes. The submission key is created in the browser and reused if the request fails, so a retry does not create a second lead. The form is cleared only after a lead id comes back. A network error, an HTML error page, or JSON without a lead id is shown as a failure.

Empty phone numbers are allowed. A phone number that is present must be a South African number (`0` plus nine digits, or `27` / `+27` plus nine digits). Other countries are rejected; the visitor can leave the phone field blank and use email. The original number is stored unchanged. When that original starts with `+`, the cell is a text formula so Sheets displays the typed number instead of evaluating it. The normalised value is `+27` and the nine national digits, stored as text so the leading `+` is not treated as a formula.

The proxy allows 8 posts per 10 minutes per client address. Apps Script allows 20 new leads per hour per email address. A retry of an existing submission key does not count toward the Apps Script limit.

## 4. Test without touching production

```bash
node --test tests/enquiry/
node scripts/check-seo.mjs
```

The Apps Script tests install an in-memory `SpreadsheetApp`. They assert the production id is the one the script would open, and they never call Google. Do not point a test run at the production spreadsheet, and do not paste sample leads into it, unless you have explicitly approved that.

To exercise the proxy locally against a fake upstream:

```bash
APPS_SCRIPT_ENQUIRY_URL='http://127.0.0.1:9/exec' \
ENQUIRY_PROXY_TOKEN='local-test-token-0123456789' \
node server/enquiry-server.mjs
```

A connection error should come back as the public failure message, with no URL or stack trace in the JSON. Replace the URL with a real `/exec` deployment only when you want a live test, and use a copy of the spreadsheet if the lead should not land in production. That means changing `SPREADSHEET_ID` in a private copy of the script, not in this repository's deployed production project.

## 5. Troubleshooting

| What you see | What to check |
| --- | --- |
| The form says it could not send the enquiry | Proxy logs, then the Apps Script execution log. The page hides the underlying reason on purpose. |
| HTTP 503 from the proxy | `APPS_SCRIPT_ENQUIRY_URL` or `ENQUIRY_PROXY_TOKEN` is missing, or the token is shorter than 16 characters. |
| Error Log code `CONFIG` | The script property `ENQUIRY_PROXY_TOKEN` is missing or too short. |
| Error Log code `UNAUTHORISED` | The proxy token and the script property differ. |
| Error Log code `HEADER_MISMATCH` | Row 1 of `Leads` was renamed or reordered. Restore the 21 headers. Do not change the script to match a new order. |
| Error Log code `SHEET_MISSING` | The `Leads` tab was renamed. The script expects `Leads`. |
| Error Log code `SPREADSHEET_UNAVAILABLE` is absent, but the visitor still gets an error and the execution log says the spreadsheet cannot be opened | The deploying Google account cannot open the spreadsheet, or the id changed. This case cannot write to `Error Log`. |
| Error Log code `LOCKED` | Another save held the script lock. The visitor can try again. The submission key keeps the retry to one row. |
| Error Log code `RATE_LIMIT` | That email address already created 20 leads in the past hour. |
| A lead appears but the dashboard total does not move | Status is not exactly `NEW`, `Duplicate of` is not blank, or column U was overwritten. Leave column U empty. |
| The monthly chart misses the lead | `Date received` is not a real date, or the spreadsheet timezone is not the timezone you expect. |
| The live form shows a failure immediately after deploy | GitHub Pages has no `/api/enquiry` route. Host the proxy first, or set `data-enquiry-endpoint` to the proxy URL. |
| Changes to the script seem to do nothing | Deploy a new web-app version. Saving the editor is not a deploy. |

Visitor-facing responses never include the spreadsheet id, the token, an exception text, or a stack trace. Look in the Apps Script executions and the proxy process output for the operational detail.

## Manual steps still required

1. Create the standalone Apps Script project and deploy the web app.
2. Add the script property `ENQUIRY_PROXY_TOKEN`.
3. Choose where the Node proxy will run and set its environment variables there.
4. If the proxy is on another origin, set `data-enquiry-endpoint` and `ENQUIRY_ALLOWED_ORIGINS` before the site goes live.
5. Approve that host, then merge. Merging to `main` publishes the site through GitHub Pages.
6. Send one real enquiry only after you are ready for it to appear on the production `Leads` tab.
