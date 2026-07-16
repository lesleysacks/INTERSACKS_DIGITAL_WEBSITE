const { getSiteUrl, json, parseRequest, validatePayment } = require('./payment-utils');

const paypalBase = () => process.env.PAYPAL_MODE === 'live'
  ? 'https://api-m.paypal.com'
  : 'https://api-m.sandbox.paypal.com';

const accessToken = async () => {
  const credentials = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString('base64');
  const response = await fetch(`${paypalBase()}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials'
  });
  if (!response.ok) throw new Error('Unable to authenticate with PayPal.');
  return (await response.json()).access_token;
};

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed.' });
  const payment = validatePayment(parseRequest(event) || {});
  if (payment.error) return json(400, payment);
  if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) return json(503, { error: 'PayPal is not configured yet.' });
  try {
    const siteUrl = getSiteUrl(event);
    const response = await fetch(`${paypalBase()}/v2/checkout/orders`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json', 'PayPal-Request-Id': `invoice-${payment.invoiceNumber}-${Date.now()}` },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{ reference_id: payment.invoiceNumber, description: `InterSacks Digital invoice ${payment.invoiceNumber}`, amount: { currency_code: 'ZAR', value: payment.amount } }],
        payment_source: { paypal: { experience_context: { return_url: `${siteUrl}/payments.html?paypal=success`, cancel_url: `${siteUrl}/payments.html?paypal=cancelled`, user_action: 'PAY_NOW', brand_name: 'InterSacks Digital' } } }
      })
    });
    const order = await response.json();
    if (!response.ok) throw new Error(order.message || 'Unable to create a PayPal order.');
    const approval = order.links.find((link) => link.rel === 'payer-action' || link.rel === 'approve');
    if (!approval) throw new Error('PayPal did not provide an approval link.');
    return json(200, { approvalUrl: approval.href });
  } catch (error) { return json(502, { error: error.message }); }
};
