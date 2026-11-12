// Minimal HTTP toolkit: router, body parsing, cookies, static files, security headers, rate limits.
import fs from 'node:fs';
import path from 'node:path';
import { HttpError } from './util.js';

export function createRouter() {
  const routes = [];
  const add = (method, pattern, handler, opts = {}) => {
    const keys = [];
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, (c) => '\\' + c);
    const re = new RegExp('^' + escaped.replace(/\/:([a-zA-Z_]+)/g, (_, k) => {
      keys.push(k);
      return '/([^/]+)';
    }) + '/?$');
    routes.push({ method, re, keys, handler, opts, pattern });
  };
  return {
    routes,
    get: (p, h, o) => add('GET', p, h, o),
    post: (p, h, o) => add('POST', p, h, o),
    patch: (p, h, o) => add('PATCH', p, h, o),
    put: (p, h, o) => add('PUT', p, h, o),
    delete: (p, h, o) => add('DELETE', p, h, o),
    match(method, pathname) {
      for (const r of routes) {
        if (r.method !== method && !(method === 'HEAD' && r.method === 'GET')) continue;
        const m = r.re.exec(pathname);
        if (!m) continue;
        const params = {};
        r.keys.forEach((k, i) => {
          try { params[k] = decodeURIComponent(m[i + 1]); } catch { params[k] = m[i + 1]; }
        });
        return { route: r, params };
      }
      return null;
    },
    allowed(pathname) {
      return [...new Set(routes.filter((r) => r.re.test(pathname)).map((r) => r.method))];
    },
  };
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    try { out[k] = decodeURIComponent(v); } catch { out[k] = v; }
  }
  return out;
}

export function cookie(name, value, { maxAge, secure, httpOnly = true, sameSite = 'Lax', path: p = '/' } = {}) {
  let c = `${name}=${encodeURIComponent(value)}; Path=${p}; SameSite=${sameSite}`;
  if (httpOnly) c += '; HttpOnly';
  if (secure) c += '; Secure';
  if (maxAge !== undefined) c += `; Max-Age=${Math.floor(maxAge)}`;
  return c;
}

export function appendCookie(res, c) {
  const prev = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', prev ? [].concat(prev, c) : [c]);
}

export function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let failed = false;
    req.on('data', (c) => {
      if (failed) return;
      size += c.length;
      if (size > limit) {
        failed = true;
        reject(new HttpError(413, 'Request body is too large'));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => { if (!failed) resolve(Buffer.concat(chunks)); });
    req.on('error', (e) => { if (!failed) reject(e); });
  });
}

/** application/x-www-form-urlencoded. Keys ending in [] collect arrays; otherwise the last value wins. */
export function parseForm(buf) {
  const out = {};
  for (const [k, v] of new URLSearchParams(buf.toString('utf8'))) {
    if (k.endsWith('[]')) {
      const key = k.slice(0, -2);
      (out[key] ||= []).push(v);
    } else out[k] = v;
  }
  return out;
}

/** multipart/form-data parser for uploads. Returns { fields, files: [{ field, filename, mime, data }] }. */
export function parseMultipart(buf, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!m) throw new HttpError(400, 'Missing multipart boundary');
  const boundary = Buffer.from('--' + (m[1] || m[2]).trim());
  const fields = {};
  const files = [];
  let pos = buf.indexOf(boundary);
  if (pos < 0) throw new HttpError(400, 'Malformed upload');
  for (;;) {
    pos += boundary.length;
    if (buf[pos] === 45 && buf[pos + 1] === 45) break;
    if (buf[pos] === 13 && buf[pos + 1] === 10) pos += 2;
    const headEnd = buf.indexOf('\r\n\r\n', pos);
    if (headEnd < 0) break;
    const headers = buf.subarray(pos, headEnd).toString('utf8');
    const next = buf.indexOf(boundary, headEnd + 4);
    if (next < 0) break;
    const content = buf.subarray(headEnd + 4, Math.max(headEnd + 4, next - 2));
    const disp = /content-disposition:\s*form-data;([^\r\n]*)/i.exec(headers);
    const name = disp && /\bname="([^"]*)"/i.exec(disp[1]);
    const filename = disp && /\bfilename="([^"]*)"/i.exec(disp[1]);
    const ctype = /content-type:\s*([^\r\n]+)/i.exec(headers);
    if (name) {
      if (filename) {
        if (filename[1] && content.length) {
          files.push({ field: name[1], filename: path.basename(filename[1].replace(/\\/g, '/')), mime: ctype ? ctype[1].trim() : 'application/octet-stream', data: Buffer.from(content) });
        }
      } else {
        const v = content.toString('utf8');
        const k = name[1];
        if (k.endsWith('[]')) (fields[k.slice(0, -2)] ||= []).push(v);
        else fields[k] = v;
      }
    }
    pos = next;
  }
  return { fields, files };
}

export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.pdf': 'application/pdf',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
};

export function securityHeaders(res, { https = false } = {}) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self' https://checkout.stripe.com https://billing.stripe.com; frame-ancestors 'self'",
  );
  if (https) res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
}

/** Serves a file from root. Returns false when the file does not exist or escapes root. */
export function serveFile(req, res, root, rel, { maxAge = 0 } = {}) {
  let decoded;
  try { decoded = decodeURIComponent(rel); } catch { return false; }
  if (decoded.includes('\0') || decoded.split(/[\\/]/).includes('..')) return false;
  const base = path.resolve(root);
  const file = path.resolve(base, '.' + path.sep + decoded);
  if (!file.startsWith(base + path.sep)) return false;
  let stat;
  try { stat = fs.statSync(file); } catch { return false; }
  if (!stat.isFile()) return false;
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
  res.setHeader('ETag', etag);
  res.setHeader('Cache-Control', maxAge ? `public, max-age=${maxAge}` : 'no-cache');
  if (req.headers['if-none-match'] === etag) {
    res.statusCode = 304;
    res.end();
    return true;
  }
  res.statusCode = 200;
  res.setHeader('Content-Type', type);
  res.setHeader('Content-Length', stat.size);
  if (req.method === 'HEAD') {
    res.end();
    return true;
  }
  fs.createReadStream(file).pipe(res);
  return true;
}

/** Fixed-window in-memory rate limiter. Good enough for a single instance; use a proxy limit for clusters. */
export function createRateLimiter() {
  const buckets = new Map();
  let lastSweep = Date.now();
  function hit(key, max, windowMs) {
    const now = Date.now();
    if (now - lastSweep > 60000) {
      for (const [k, b] of buckets) if (b.reset < now) buckets.delete(k);
      lastSweep = now;
    }
    let b = buckets.get(key);
    if (!b || b.reset < now) {
      b = { count: 0, reset: now + windowMs };
      buckets.set(key, b);
    }
    b.count++;
    if (b.count > max) throw new HttpError(429, 'Too many attempts. Please wait a few minutes and try again.');
  }
  hit.clear = (key) => buckets.delete(key);
  return hit;
}
