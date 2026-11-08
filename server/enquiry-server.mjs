/**
 * Local and production entry point for the enquiry proxy.
 *
 *   APPS_SCRIPT_ENQUIRY_URL=... ENQUIRY_PROXY_TOKEN=... node server/enquiry-server.mjs
 *
 * Bind address defaults to 127.0.0.1. Set ENQUIRY_BIND=0.0.0.0 when the
 * process is behind a reverse proxy on a server.
 */
import http from 'node:http';
import { handleEnquiry } from './enquiry-handler.mjs';

const BODY_LIMIT = 20000;

export function createEnquiryServer(options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl;
  const rateLimit = options.rateLimit || {
    limit: 8,
    windowMs: 10 * 60 * 1000,
    store: new Map()
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

function clientIp(req, env) {
  if (String(env.ENQUIRY_TRUST_PROXY || '').toLowerCase() === 'true') {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) return String(forwarded).split(',')[0].trim();
  }
  return req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : 'unknown';
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
