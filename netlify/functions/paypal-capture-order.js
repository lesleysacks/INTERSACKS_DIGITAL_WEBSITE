const { json, parseRequest } = require('./payment-utils');

const paypalBase = () => process.env.PAYPAL_MODE === 'live'
  ? 'https://api-m.paypal.com'
  : 'https://api-m.sandbox.paypal.com';

const accessToken = async () => {
  const credentials = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString('base64');
  const response = await fetch(`${paypalBase()}/v1/oauth2/token`, { method: 'POST', headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' });
  if (!response.ok) throw new Error('Unable to authenticate with PayPal.');
  return (await response.json()).access_token;
};

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed.' });
  const orderId = String((parseRequest(event) || {}).orderId || '');
  if (!/^[A-Z0-9]{10,30}$/i.test(orderId)) return json(400, { error: 'Invalid PayPal order.' });
  try {
    const response = await fetch(`${paypalBase()}/v2/checkout/orders/${orderId}/capture`, { method: 'POST', headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' } });
    const order = await response.json();
    if (!response.ok) throw new Error(order.message || 'Unable to capture the PayPal payment.');
    const capture = order.purchase_units?.[0]?.payments?.captures?.[0];
    return json(200, { status: capture?.status, invoiceNumber: order.purchase_units?.[0]?.reference_id, transactionId: capture?.id });
  } catch (error) { return json(502, { error: error.message }); }
};
