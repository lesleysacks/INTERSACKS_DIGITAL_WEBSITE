const crypto = require('crypto');

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(body)
});

const getSiteUrl = (event) => {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, '');
  const protocol = event.headers['x-forwarded-proto'] || 'https';
  return `${protocol}://${event.headers.host}`;
};

const parseRequest = (event) => {
  try { return JSON.parse(event.body || '{}'); } catch { return null; }
};

const validatePayment = (data) => {
  const invoiceNumber = String(data.invoiceNumber || '').trim().slice(0, 64);
  const customerName = String(data.customerName || '').trim().slice(0, 100);
  const customerEmail = String(data.customerEmail || '').trim().slice(0, 100);
  const amount = Number(data.amount);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(invoiceNumber)) return { error: 'Enter a valid invoice number.' };
  if (!Number.isFinite(amount) || amount < 5 || amount > 1000000) return { error: 'Enter an amount between R5.00 and R1,000,000.00.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) return { error: 'Enter a valid email address.' };
  return { invoiceNumber, customerName: customerName || 'Customer', customerEmail, amount: amount.toFixed(2) };
};

const payfastEncode = (value) => encodeURIComponent(String(value).trim()).replace(/%20/g, '+');
const payfastSignature = (data, passphrase) => {
  const source = Object.entries(data)
    .filter(([key, value]) => key !== 'signature' && value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}=${payfastEncode(value)}`)
    .join('&');
  const payload = passphrase ? `${source}&passphrase=${payfastEncode(passphrase)}` : source;
  return crypto.createHash('md5').update(payload).digest('hex');
};

module.exports = { getSiteUrl, json, parseRequest, payfastSignature, validatePayment };
