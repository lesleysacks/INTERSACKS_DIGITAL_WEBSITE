/**
 * Local and production entry point for the enquiry proxy.
 *
 *   APPS_SCRIPT_ENQUIRY_URL=... ENQUIRY_PROXY_TOKEN=... node server/enquiry-server.mjs
 *
 * Bind address defaults to 127.0.0.1. Set ENQUIRY_BIND=0.0.0.0 only when a
 * reverse proxy is the only path to this process.
 *
 * ENQUIRY_TRUST_PROXY must be the string "true" and the proxy must overwrite
 * X-Forwarded-For with the client it accepted (nginx: $remote_addr). The
 * rightmost address is used. Client-supplied prefixes are ignored. Leave
 * the flag unset when that overwrite cannot be guaranteed. X-Real-IP is
 * never read. ENQUIRY_TRUSTED_HOPS skips that many infrastructure addresses
 * from the right; the default is 0.
 */
import http from 'node:http';
import { handleEnquiry } from './enquiry-handler.mjs';

const BODY_LIMIT = 20000;

export function createEnquiryServer(options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl;
  const rateLimit = options.rateLimit || {
    store: new Map(),
    globalHits: []
  };

  return http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (url.pathname !== '/api/enquiry') {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ ok: false, message: 'Not found.' }));
      return;
    }

    let bodyText = '';
    try {
      bodyText = await readBody(req, BODY_LIMIT);
    } catch (error) {
      const status = error && error.code === 'TOO_LARGE' ? 400 : 400;
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ ok: false, message: 'Check the enquiry and try again.' }));
      return;
    }

    const result = await handleEnquiry({
      method: req.method || 'GET',
      headers: req.headers,
      bodyText,
      ip: clientIp(req, env)
    }, { env, fetchImpl, rateLimit });

    res.writeHead(result.status, result.headers);
    res.end(result.body);
  });
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let failed = false;
    req.on('data', (chunk) => {
      if (failed) return;
      size += chunk.length;
      if (size > limit) {
        failed = true;
        reject(Object.assign(new Error('too_large'), { code: 'TOO_LARGE' }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!failed) resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', (error) => {
      if (!failed) reject(error);
    });
  });
}

export function clientIp(req, env) {
  const socketIp = req.socket && req.socket.remoteAddress ? String(req.socket.remoteAddress) : 'unknown';
  if (String(env.ENQUIRY_TRUST_PROXY || '').toLowerCase() !== 'true') return socketIp;
  const hops = forwardedHops(req.headers);
  const index = hops.length - 1 - trustedHops(env.ENQUIRY_TRUSTED_HOPS);
  if (index < 0) return socketIp;
  return isIpAddress(hops[index]) ? hops[index] : socketIp;
}

function forwardedHops(headers) {
  if (!headers) return [];
  const value = headers['x-forwarded-for'];
  const text = Array.isArray(value) ? value.join(',') : value;
  if (typeof text !== 'string' || !text.trim()) return [];
  return text.split(',').map((part) => part.trim()).filter(Boolean);
}

function trustedHops(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 8) return 0;
  return parsed;
}

function isIpAddress(value) {
  if (typeof value !== 'string' || value.length < 2 || value.length > 45) return false;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(value);
  if (mapped) return isIpv4(mapped[1]);
  if (value.includes(':')) {
    if (!/^[0-9a-fA-F:]+$/.test(value)) return false;
    return value.split('::').length <= 2;
  }
  return isIpv4(value);
}

function isIpv4(value) {
  const parts = value.split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255 && String(Number(part)) === part);
}

const isDirectRun = process.argv[1] && process.argv[1].endsWith('enquiry-server.mjs');
if (isDirectRun) {
  const port = Number(process.env.PORT || 8787);
  const host = process.env.ENQUIRY_BIND || '127.0.0.1';
  const server = createEnquiryServer();
  server.listen(port, host, () => {
    process.stdout.write(`Enquiry proxy listening on http://${host}:${port}/api/enquiry\n`);
  });
}
