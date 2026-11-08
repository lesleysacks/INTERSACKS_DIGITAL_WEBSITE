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
5. Open **Project settings > Script properties** and add `ENQUIRY_PROXY_TOKEN`. Generate it with `openssl rand -hex 32`. That command prints 64 hex characters, which is 32 bytes. The same value goes on the proxy. It is the HMAC-SHA256 key. A shorter value is treated as missing configuration and every submission is rejected. The proxy does not send this value; it sends a timestamp, a nonce, and an HMAC-SHA256 signature. Run the command on the operator's machine, paste the output only into the script property and the proxy environment, and do not commit it, print it, or paste it into a ticket or log.
6. Deploy **Web app**. Execute as **Me**. Who has access: **Anyone**. Copy the URL that ends in `/exec`.
7. The Google account that deploys the web app needs edit access to the spreadsheet. The header row is protected with a warning only, so the script can still append a lead.

Redeploy as a new version after every script change. An existing `/exec` URL does not pick up saved code until you deploy a new version.

Check that the spreadsheet timezone is `Africa/Johannesburg` so the monthly dashboard buckets match the lead-id date. This repository does not change that setting.

## 2. Configure the proxy

The proxy reads these variables from the environment. Do not commit real values. `.env.example` lists the names.

| Variable | Purpose |
| --- | --- |
| `APPS_SCRIPT_ENQUIRY_URL` | The web app `/exec` URL from the deploy step. |
| `ENQUIRY_PROXY_TOKEN` | HMAC-SHA256 key. Same secret as the Apps Script property `ENQUIRY_PROXY_TOKEN`. At least 32 bytes, stored as the 64 hex characters from `openssl rand -hex 32`. |
| `ENQUIRY_ALLOWED_ORIGINS` | Comma-separated browser origins. Defaults to `https://www.intersacks.co.za` and `https://intersacks.co.za` when unset. |
| `ENQUIRY_UPSTREAM_TIMEOUT_MS` | Optional. How long the proxy waits for Apps Script before aborting. Defaults to 15000 and is clamped to 1000–30000. |
| `ENQUIRY_RATE_LIMIT` | Optional. Enquiries per client address in one process. Defaults to 8. |
| `ENQUIRY_RATE_WINDOW_MS` | Optional. Window for that address limit. Defaults to 600000 (10 minutes). |
| `ENQUIRY_GLOBAL_RATE_LIMIT` | Optional. Enquiries per process in the global window. Defaults to 60. |
| `ENQUIRY_GLOBAL_RATE_WINDOW_MS` | Optional. Defaults to 60000 (1 minute). |
| `PORT` | Optional. Defaults to `8787`. |
| `ENQUIRY_BIND` | Optional. Defaults to `127.0.0.1`. Use a private interface only when a reverse proxy is the only path to the process. |
| `ENQUIRY_TRUST_PROXY` | Optional. The string `true` only, and only under the conditions in "Client address" below. `1` and `yes` do not enable it. |
| `ENQUIRY_TRUSTED_HOPS` | Optional. Infrastructure addresses to skip from the right of `X-Forwarded-For`. Default `0`. Ignored unless `ENQUIRY_TRUST_PROXY=true`. |

Start it with:

Generate the key, then export the variables. Do not echo the key back into a shell history you share, and do not commit the output.

```bash
openssl rand -hex 32
export APPS_SCRIPT_ENQUIRY_URL='https://script.google.com/macros/s/DEPLOYMENT_ID/exec'
export ENQUIRY_PROXY_TOKEN='paste-the-64-hex-characters-here'
export ENQUIRY_ALLOWED_ORIGINS='https://www.intersacks.co.za,https://intersacks.co.za'
node server/enquiry-server.mjs
```

The process serves `POST /api/enquiry`. For each enquiry it builds a fresh nonce and a unix timestamp, then HMAC-SHA256 signs `enquiry.v1`, the timestamp, the nonce, and the enquiry fields with `ENQUIRY_PROXY_TOKEN`. Apps Script accepts the signature for five minutes. It then tries to remember the nonce for ten minutes. A second use of a nonce that is still in the cache is rejected. The proxy follows the Apps Script redirect and returns `{ "ok": true, "leadId": "ISD-..." }` only when Apps Script confirms the write. Apps Script itself usually answers HTTP 200 for both success and failure, so the proxy reads the JSON `ok` field. The upstream call uses `AbortController` and stops at `ENQUIRY_UPSTREAM_TIMEOUT_MS`.

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

The proxy allows 8 posts per 10 minutes per client address, and 60 posts per minute for the whole process. Apps Script allows 20 new leads per hour per email address. A retry of an existing submission key does not count toward the Apps Script limit. A new signature is created for every proxy attempt, so a failed save can be retried with the same submission key and a new nonce.

### Client address

No Node host is selected yet. GitHub Pages cannot run this process. These rules apply to whichever host you choose (a VPS, Fly.io, Render, Railway, Cloud Run, or another Node service).

`clientIp()` ignores `X-Forwarded-For` and `X-Real-IP` unless `ENQUIRY_TRUST_PROXY` is exactly `true` (any other value, including `1` and `yes`, leaves the headers ignored). The socket address is used instead. A visitor cannot pick a rate-limit bucket by sending a forwarding header to a process that is directly reachable.

Set `ENQUIRY_TRUST_PROXY=true` only when both of these are true:

1. The Node port is not reachable from the public internet. Keep `ENQUIRY_BIND` on `127.0.0.1` or another private interface, and let only the reverse proxy connect.
2. That proxy overwrites `X-Forwarded-For` with the TCP client it accepted. It must not copy a value the visitor sent.

On nginx, that overwrite is:

```nginx
proxy_set_header X-Forwarded-For $remote_addr;
```

Use `$remote_addr`. Do not use `$proxy_add_x_forwarded_for` or `$http_x_forwarded_for`. `$remote_addr` is the address nginx accepted, so a visitor cannot choose it.

With the flag on, the app reads the rightmost address in `X-Forwarded-For`, not the leftmost. The leftmost is where a client-supplied prefix sits when a proxy appends. The rightmost is the address the nearest proxy observed. After the nginx line above, the header has one address and that address is the client. A value that is not an IP is discarded and the socket address is used.

`ENQUIRY_TRUSTED_HOPS` defaults to `0`. Set it only when another trusted proxy appends its own peer address to the right of the client. The number is how many of those infrastructure addresses to skip, counting from the right. For one nginx hop configured as above, leave it unset.

If the host's documentation does not say that it overwrites the header, or that the process is unreachable except through that proxy, leave `ENQUIRY_TRUST_PROXY` unset. Every visitor then shares the platform's socket address. That one bucket cannot be spoofed. It is a stricter limit, and it is the safe default.

### Rate-limit limits

The Node counters live in a `Map` inside one process. They are not a guaranteed global limit.

- They disappear when that process restarts.
- They are not shared by a second instance. Two replicas allow twice as many requests before Apps Script sees them.
- Clients that share the address `unknown`, or that share the proxy's socket address when `ENQUIRY_TRUST_PROXY` is unset, share one bucket.
- Idle addresses are removed after their window expires. A burst of distinct addresses can still grow the map until those windows end.
- Apps Script's per-email counter is also best-effort. It is stored in `CacheService` for up to one hour and can be evicted earlier. If the counter read or write throws, the check fails open and the lead is still saved. That decision keeps a cache blip from dropping a real enquiry that has already passed HMAC and nonce checks. It means 20 leads per hour is not a guaranteed cap. If the whole script cache is unavailable, nonce storage fails closed first and the enquiry is rejected before this fail-open path runs.

### Nonce replay protection

Nonce check and insert run inside `LockService.getScriptLock()`, after the signature has been accepted and before the spreadsheet is opened. Two executions cannot both observe a missing nonce and both insert a lead.

`CacheService` is a cache, not a database. Google can evict an entry before the 600-second TTL, the longest TTL the service accepts is six hours, and a nonce that has been evicted can be presented again until the signed timestamp is outside the five-minute window. Do not treat the cache as permanent or guaranteed storage. If `get` or `put` throws, or the value does not read back after `put`, the script fails closed and does not write the lead.

### Error Log

Invalid JSON, a missing signature, an invalid signature, an expired signature, and missing authentication configuration do not open the spreadsheet and do not append `Error Log`. Those failures go to the Apps Script execution log as `Unauthenticated enquiry rejected: CODE`, at most once a minute per code while the script cache is available. If that cache is down, each execution still writes one fixed line and still does not write a row.

After a valid signature, operational failures still append the existing five columns: Timestamp, Code, Stage, Lead ID, Detail (no personal data). The script writes that row only when those headers are unchanged.

## 4. Test without touching production

```bash
npm test
node scripts/check-seo.mjs
```

The Apps Script tests install an in-memory `SpreadsheetApp`. They assert the production id is the one the script would open, and they never call Google. Do not point a test run at the production spreadsheet, and do not paste sample leads into it, unless you have explicitly approved that.

To exercise the proxy locally against a fake upstream:

```bash
APPS_SCRIPT_ENQUIRY_URL='http://127.0.0.1:9/exec' \
ENQUIRY_PROXY_TOKEN="$(openssl rand -hex 32)" \
node server/enquiry-server.mjs
```

That local value exists only in the process environment. Do not copy it into the repository.

A connection error should come back as the public failure message, with no URL or stack trace in the JSON. Replace the URL with a real `/exec` deployment only when you want a live test, and use a copy of the spreadsheet if the lead should not land in production. That means changing `SPREADSHEET_ID` in a private copy of the script, not in this repository's deployed production project.

## 5. Troubleshooting

| What you see | What to check |
| --- | --- |
| The form says it could not send the enquiry | Proxy logs, then the Apps Script execution log. The page hides the underlying reason on purpose. |
| HTTP 503 from the proxy | `APPS_SCRIPT_ENQUIRY_URL` or `ENQUIRY_PROXY_TOKEN` is missing, or the token is shorter than 64 hex characters (32 bytes). |
| Execution log `Unauthenticated enquiry rejected: CONFIG` | The script property `ENQUIRY_PROXY_TOKEN` is missing or shorter than 64 characters. This does not write `Error Log`. |
| Execution log `Unauthenticated enquiry rejected: UNAUTHORISED` | The signature does not match, or the timestamp, nonce, or signature is missing. This does not write `Error Log`. |
| Execution log `Unauthenticated enquiry rejected: EXPIRED` | The signed timestamp is more than five minutes from the script clock. Check the proxy clock. This does not write `Error Log`. |
| Execution log `Unauthenticated enquiry rejected: INVALID_JSON` | The body was not a JSON object. This does not write `Error Log`. |
| Error Log code `REPLAY` | That nonce was already used. The proxy should send a new nonce on every attempt. |
| Error Log code `AUTH_UNAVAILABLE` | The script cache could not record the nonce, so the lead was not written. |
| HTTP 504 from the proxy | Apps Script did not answer before `ENQUIRY_UPSTREAM_TIMEOUT_MS`. The visitor still sees the normal failure message. |
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
2. Generate `ENQUIRY_PROXY_TOKEN` with `openssl rand -hex 32` and add that script property. Do not commit or print the value.
3. Choose where the Node proxy will run and set its environment variables there.
4. If the proxy is on another origin, set `data-enquiry-endpoint` and `ENQUIRY_ALLOWED_ORIGINS` before the site goes live.
5. Approve that host, then merge. Merging to `main` publishes the site through GitHub Pages.
6. Send one real enquiry only after you are ready for it to appear on the production `Leads` tab.
