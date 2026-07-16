const { payfastSignature } = require('./payment-utils');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  const data = Object.fromEntries(new URLSearchParams(event.body || ''));
  const validSignature = data.signature && data.signature === payfastSignature(data, process.env.PAYFAST_PASSPHRASE);
  if (!validSignature) return { statusCode: 400, body: 'Invalid signature' };

  const validateUrl = process.env.PAYFAST_MODE === 'live'
    ? 'https://www.payfast.co.za/eng/query/validate'
    : 'https://sandbox.payfast.co.za/eng/query/validate';
  const validation = await fetch(validateUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(data).toString()
  });
  if (!validation.ok || (await validation.text()).trim() !== 'VALID') return { statusCode: 400, body: 'Payment validation failed' };

  // Store this verified notification in your database or invoice system before acknowledging it.
  console.log(JSON.stringify({ provider: 'payfast', paymentId: data.m_payment_id, status: data.payment_status, amount: data.amount_gross }));
  return { statusCode: 200, body: 'OK' };
};
