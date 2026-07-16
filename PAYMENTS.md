# Payments on Netlify

This project contains hosted checkout flows for PayFast and PayPal. The browser never receives the PayFast passphrase or the PayPal client secret.

## Netlify configuration

1. Create a Netlify site from this repository. `netlify.toml` automatically exposes the functions in `netlify/functions`.
2. In **Site configuration > Environment variables**, add every variable in `.env.example` with your sandbox credentials.
3. Set `SITE_URL` to the deployed site URL, such as `https://intersacks-digital.netlify.app`.
4. Use `PAYFAST_MODE=sandbox` and `PAYPAL_MODE=sandbox` while testing. Change both to `live` only after successful sandbox tests.
5. Set your PayFast notification URL to `https://your-domain/.netlify/functions/payfast-itn` if it is not supplied automatically during checkout.

## Before launch

- Create and test a PayFast sandbox merchant account and PayPal sandbox business account.
- Confirm the invoice number and amount shown on the payment page against an invoice managed by your business.
- Connect `payfast-itn.js` and `paypal-capture-order.js` to your invoice database or CRM before automatically marking invoices as paid. At present, validated PayFast notifications are logged by Netlify, which is suitable for sandbox verification but not long-term reconciliation.
- Add webhook/payment event monitoring and a manual refund process.

## Security notes

- Do not put secrets in HTML, CSS, JavaScript, or source control.
- A payment return URL is not proof of payment. PayFast verification and PayPal capture occur server-side.
- The public payment page accepts a custom amount. For strict invoice collection, replace the amount input with a server-side invoice lookup keyed by a signed payment link or authenticated invoice number.
