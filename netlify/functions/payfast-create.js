const { getSiteUrl, json, parseRequest, payfastSignature, validatePayment } = require('./payment-utils');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed.' });
  const payment = validatePayment(parseRequest(event) || {});
  if (payment.error) return json(400, payment);
  const { PAYFAST_MERCHANT_ID, PAYFAST_MERCHANT_KEY, PAYFAST_PASSPHRASE, PAYFAST_MODE = 'sandbox' } = process.env;
  if (!PAYFAST_MERCHANT_ID || !PAYFAST_MERCHANT_KEY) return json(503, { error: 'PayFast is not configured yet.' });

  const siteUrl = getSiteUrl(event);
  const fields = {
    merchant_id: PAYFAST_MERCHANT_ID,
    merchant_key: PAYFAST_MERCHANT_KEY,
    return_url: `${siteUrl}/payments.html?payfast=success`,
    cancel_url: `${siteUrl}/payments.html?payfast=cancelled`,
    notify_url: `${siteUrl}/.netlify/functions/payfast-itn`,
    name_first: payment.customerName,
    email_address: payment.customerEmail,
    m_payment_id: payment.invoiceNumber,
    amount: payment.amount,
    item_name: `Invoice ${payment.invoiceNumber}`
  };
  fields.signature = payfastSignature(fields, PAYFAST_PASSPHRASE);
  const checkoutUrl = PAYFAST_MODE === 'live'
    ? 'https://www.payfast.co.za/eng/process'
    : 'https://sandbox.payfast.co.za/eng/process';
  return json(200, { checkoutUrl, fields });
};
