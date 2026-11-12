// App server: configuration, services, request handling (static files, sessions, API keys, CSRF, body parsing, read-only access), the response protocol and scheduled jobs.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HttpError, hmac, nowISO, randomToken, safeEqual } from './util.js';
import { createRouter, parseCookies, cookie, appendCookie, readBody, parseForm, parseMultipart, securityHeaders, serveFile, createRateLimiter } from './http.js';
import { openDb, CORE_SCHEMA } from './db.js';
import { createAuth, clientIp, roleRank } from './auth.js';
import { createBilling } from './billing.js';
import { createMailer } from './mailer.js';
import { createFiles } from './files.js';
import { createJobs } from './jobs.js';
import { createResources } from './resources.js';
import { createResourceCsv } from './resource-csv.js';
import { registerCrud } from './crud.js';
import { registerApi } from './api.js';
import { registerWorkspace } from './workspace.js';
import { registerTeam } from './team.js';
import { registerBilling } from './billing-pages.js';
import { registerPages } from './pages.js';
import { appPage, errorPage } from './layout.js';
import { html, isSafe, render, pageHeader, stats, button } from './ui.js';

export const CORE_PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const isTrue = (v) => /^(1|true|yes|on)$/i.test(String(v ?? '').trim());
const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
// Paths that still accept changes when a workspace is read only (trial ended or payment failed).
const READ_ONLY_OK = [/^\/app\/billing(\/|$)/, /^\/app\/account(\/|$)/, /^\/app\/switch$/, /^\/app\/settings\/delete$/, /^\/app\/team\/leave$/];
// Form errors that send people back to the page they came from with a red message.
const BACK_STATUSES = new Set([400, 402, 403, 409, 410, 413, 415, 422, 429]);
const toHtml = (v) => (typeof v === 'string' ? v : render(v));

function devSecret(dataDir) {
  const file = path.join(dataDir, 'secret');
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  const s = randomToken(32);
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(file, s, { mode: 0o600 });
  return s;
}

/** Reads settings from environment variables. Production refuses to start without APP_SECRET and BASE_URL. */
export function loadConfig(def, env = process.env) {
  const port = Number(env.PORT || def.port || 3000);
  const dataDir = path.resolve(env.DATA_DIR || path.join(process.cwd(), 'data', def.slug));
  const baseUrl = String(env.BASE_URL || `http://localhost:${port}`).replace(/\/+$/, '');
  const production = env.NODE_ENV === 'production';
  if (production && !env.APP_SECRET) throw new Error('Set APP_SECRET (a long random string) before running in production.');
  if (production && !env.BASE_URL) throw new Error('Set BASE_URL (for example https://app.example.com) before running in production.');
  const config = {
    NODE_ENV: env.NODE_ENV || 'development',
    PORT: port,
    DATA_DIR: dataDir,
    DB_FILE: env.DB_FILE || path.join(dataDir, `${def.slug}.db`),
    BASE_URL: baseUrl,
    TIMEZONE: env.TIMEZONE || 'Europe/London',
    MAX_UPLOAD_MB: Number(env.MAX_UPLOAD_MB || 10),
    APP_SECRET: env.APP_SECRET || devSecret(dataDir),
    SECURE_COOKIES: env.SECURE_COOKIES !== undefined ? isTrue(env.SECURE_COOKIES) : baseUrl.startsWith('https://'),
    TRUST_PROXY: isTrue(env.TRUST_PROXY),
    RESEND_API_KEY: env.RESEND_API_KEY || '',
    POSTMARK_TOKEN: env.POSTMARK_TOKEN || '',
    MAIL_FROM: env.MAIL_FROM || '',
    STRIPE_SECRET_KEY: env.STRIPE_SECRET_KEY || '',
    STRIPE_WEBHOOK_SECRET: env.STRIPE_WEBHOOK_SECRET || '',
    ALLOW_FAKE_BILLING: isTrue(env.ALLOW_FAKE_BILLING),
    ALLOW_INDEXING: isTrue(env.ALLOW_INDEXING),
    CONTACT_TO: env.CONTACT_TO || '',
    SUPPORT_EMAIL: env.SUPPORT_EMAIL || '',
    LOG_REQUESTS: isTrue(env.LOG_REQUESTS),
    DISABLE_JOBS: isTrue(env.DISABLE_JOBS),
    // People who can open the founder console, by login email. Outside production the first user also can.
    FOUNDER_EMAILS: String(env.FOUNDER_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  };
  for (const [k, v] of Object.entries(env)) if (k.startsWith('STRIPE_PRICE_') && v) config[k] = v;
  return config;
}

function normalise(def) {
  if (!def || typeof def !== 'object') throw new Error('createApp needs a product definition.');
  if (!/^[a-z][a-z0-9-]{1,30}$/.test(String(def.slug || ''))) throw new Error('definition.slug must be 2 to 31 lowercase letters, numbers or dashes.');
  if (!def.name) throw new Error('definition.name is required.');
  return { tagline: '', description: '', plans: [], resources: [], ...def };
}

function defaultDashboard(ctx) {
  const { resources, db } = ctx.services;
  const items = resources.all.map((r) => ({
    label: r.label,
    value: db.get(`SELECT COUNT(*) AS n FROM "${r.table}" WHERE org_id = ?`, ctx.org.id).n,
    href: `/app/${r.name}`,
  }));
  return appPage(ctx, { title: 'Dashboard', active: 'dashboard', body: html`${pageHeader({ title: `Welcome, ${ctx.user.name || 'there'}`, subtitle: ctx.org.name })}${stats(items)}` });
}

/**
 * Builds a product app from its definition.
 * options: { env, inheritEnv, db, log, rateLimit, jobs }.
 * Returns { server, services, router, handle, start, close, cli, config, definition }.
 */
export function createApp(definition, options = {}) {
  const def = normalise(definition);
  const env = options.inheritEnv === false ? { ...(options.env || {}) } : { ...process.env, ...(options.env || {}) };
  const config = loadConfig(def, env);
  const log = options.log || console;
  const db = options.db || openDb(config.DB_FILE);
  db.exec(CORE_SCHEMA);
  const auth = createAuth({ db, config, definition: def });
  const resources = createResources({ db, definition: def });
  const csv = createResourceCsv({ db, resources });
  const files = createFiles({ db, config });
  const mailer = createMailer({ db, config, definition: def, log });
  const billing = createBilling({ db, config, definition: def });
  const limiter = options.rateLimit === false ? null : createRateLimiter();
  const services = { config, db, definition: def, auth, resources, csv, files, mailer, billing, limiter, log };
  services.deleteOrg = (orgId) => {
    files.removeOrg(orgId);
    db.run('DELETE FROM orgs WHERE id = ?', orgId);
    try {
      db.run("DELETE FROM users WHERE email LIKE '%@demo.invalid' AND id NOT IN (SELECT user_id FROM memberships)");
    } catch (err) {
      log.warn?.(`Could not tidy demo users: ${err.message}`);
    }
  };
  services.jobs = createJobs(services);
  auth.hooks.onOrgCreated = (org) => def.onOrgCreated?.(services, org);
  def.setup?.(services);

  // Product routes first so a product can replace any core page, then public pages, workspace pages, records and the API.
  const router = createRouter();
  def.routes?.(router, services);
  registerPages(router);
  router.get('/app', (ctx) => (def.dashboard ? def.dashboard(ctx) : defaultDashboard(ctx)));
  registerWorkspace(router);
  registerTeam(router);
  registerBilling(router);
  registerCrud(router);
  registerApi(router);

  const baseOrigin = new URL(config.BASE_URL).origin;
  const productPublic = def.publicDir ? path.resolve(def.publicDir instanceof URL ? fileURLToPath(def.publicDir) : String(def.publicDir)) : null;
  const FLASH = `${def.slug}_flash`;
  const PRE = `${def.slug}_pre`;

  const normFlash = (f) => (typeof f === 'string' ? { text: f, tone: 'green' } : { text: String(f?.text || ''), tone: f?.tone || 'green' });
  function setFlash(res, list) {
    const v = Buffer.from(JSON.stringify(list.slice(0, 5))).toString('base64url');
    appendCookie(res, cookie(FLASH, `${v}.${hmac(config.APP_SECRET, `flash:${v}`)}`, { maxAge: 120, secure: config.SECURE_COOKIES }));
  }
  function readFlash(ctx) {
    const value = ctx.cookies[FLASH];
    if (!value) return;
    ctx.flashCookie = true;
    const [v, sig] = String(value).split('.');
    if (!v || !sig || !safeEqual(sig, hmac(config.APP_SECRET, `flash:${v}`))) return;
    let list = [];
    try {
      list = JSON.parse(Buffer.from(v, 'base64url').toString('utf8'));
    } catch {
      list = [];
    }
    if (!Array.isArray(list)) return;
    for (const f of list.slice(0, 5)) if (f && typeof f.text === 'string') ctx.flash.push({ text: f.text.slice(0, 500), tone: f.tone });
  }
  function clearFlash(ctx) {
    if (ctx.flashCookie) appendCookie(ctx.res, cookie(FLASH, '', { maxAge: 0, secure: config.SECURE_COOKIES }));
    ctx.flashCookie = false;
  }

  // Forms shown to signed-out visitors are protected with a double-submit cookie.
  function anonCsrf(ctx) {
    let pre = ctx.cookies[PRE];
    if (!pre || !/^[A-Za-z0-9_-]{16,64}$/.test(pre)) {
      pre = randomToken(18);
      ctx.cookies[PRE] = pre;
      appendCookie(ctx.res, cookie(PRE, pre, { maxAge: 7 * 86400, secure: config.SECURE_COOKIES }));
    }
    return hmac(config.APP_SECRET, `pre:${pre}`);
  }
  function checkCsrf(ctx) {
    const sent = String(ctx.body?._csrf ?? ctx.req.headers['x-csrf-token'] ?? '');
    if (!sent || !ctx.csrf || !safeEqual(sent, ctx.csrf)) throw new HttpError(403, 'This form has expired. Please refresh the page and try again.');
    const source = ctx.req.headers.origin || ctx.req.headers.referer;
    if (source && source !== 'null') {
      let o = '';
      try {
        o = new URL(source).origin;
      } catch {
        o = '';
      }
      const host = ctx.req.headers.host;
      if (o !== baseOrigin && o !== `http://${host}` && o !== `https://${host}`) throw new HttpError(403, 'Forms can only be sent from this site.');
    }
  }

  function authenticate(ctx) {
    const header = ctx.req.headers.authorization;
    if (ctx.isApi && header) {
      const a = auth.authenticateApiKey(header);
      if (!a) throw new HttpError(401, 'That API key is not valid or has been revoked.');
      Object.assign(ctx, { user: a.user, org: a.org, role: a.role, apiKey: a.apiKey });
      return;
    }
    const s = auth.loadSession(ctx.cookies);
    if (s) Object.assign(ctx, { session: s.session, user: s.user, org: s.org, role: s.role });
  }
  function prepareSignedIn(ctx) {
    if (ctx.org) ctx.access = billing.access(ctx.org);
    if (ctx.session) ctx.csrf = auth.csrfFor(ctx.session);
  }

  async function readRequestBody(ctx, opts) {
    const type = String(ctx.req.headers['content-type'] || '').toLowerCase();
    const multipart = type.startsWith('multipart/form-data');
    const limit = multipart ? (config.MAX_UPLOAD_MB + 2) * 1048576 : opts.raw ? 1048576 : ctx.isApi ? 2 * 1048576 : 16 * 1048576;
    const buf = await readBody(ctx.req, limit);
    if (opts.raw) {
      ctx.rawBody = buf;
      return;
    }
    if (multipart) {
      const { fields, files: uploads } = parseMultipart(buf, ctx.req.headers['content-type']);
      ctx.body = fields || {};
      ctx.files = uploads || [];
    } else if (type.startsWith('application/json')) {
      if (!buf.length) ctx.body = {};
      else {
        try {
          ctx.body = JSON.parse(buf.toString('utf8'));
        } catch {
          throw new HttpError(400, 'The request body is not valid JSON.');
        }
      }
    } else if (!type || type.startsWith('application/x-www-form-urlencoded')) {
      ctx.body = parseForm(buf);
    } else if (ctx.isApi) {
      throw new HttpError(415, 'Send JSON with the header Content-Type: application/json.');
    } else {
      ctx.body = {};
    }
  }

  function serveStatic(ctx) {
    const { req, res } = ctx;
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;
    const p = ctx.path;
    if (p === '/favicon.ico') {
      res.statusCode = 301;
      res.setHeader('Location', def.theme?.favicon ? `/static/${def.theme.favicon}` : '/assets/favicon.svg');
      res.end();
      return true;
    }
    let root = null;
    if (p.startsWith('/assets/')) root = CORE_PUBLIC;
    else if (p.startsWith('/static/') && productPublic) root = productPublic;
    if (!root) return false;
    if (!serveFile(req, res, root, p.slice(8), { maxAge: ctx.query.v ? 31536000 : 3600 })) throw new HttpError(404, 'File not found');
    return true;
  }

  function sendHtml(ctx, status, body) {
    const { req, res } = ctx;
    clearFlash(ctx);
    res.statusCode = status;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(req.method === 'HEAD' ? undefined : body);
  }
  function sendJson(ctx, status, data) {
    const { req, res } = ctx;
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(req.method === 'HEAD' ? undefined : JSON.stringify(data));
  }
  function safeLocation(loc) {
    const s = String(loc || '/');
    if (/[\r\n\t]/.test(s)) return '/';
    if (s.startsWith('/') && !s.startsWith('//') && !s.startsWith('/\\')) return s;
    if (/^https:\/\/(checkout|billing)\.stripe\.com\//.test(s)) return s;
    return '/';
  }
  function sendRedirect(ctx, loc, flash = null, status = 303) {
    const { res } = ctx;
    const carry = [...ctx.flash, ...(flash ? [normFlash(flash)] : [])].filter((f) => f.text);
    if (carry.length) setFlash(res, carry);
    else clearFlash(ctx);
    res.statusCode = status;
    res.setHeader('Location', safeLocation(loc));
    res.setHeader('Cache-Control', 'no-store');
    res.end();
  }
  function sendDownload(ctx, { body, type = 'application/octet-stream', filename = 'download' }) {
    const { req, res } = ctx;
    const ascii = String(filename).replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '');
    clearFlash(ctx);
    res.statusCode = 200;
    res.setHeader('Content-Type', type);
    res.setHeader('Content-Disposition', `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.end(req.method === 'HEAD' ? undefined : body);
  }
  function sendBody(ctx, { body, type = 'text/plain; charset=utf-8', status = 200, headers = {} }) {
    const { req, res } = ctx;
    res.statusCode = status;
    res.setHeader('Content-Type', type);
    for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
    res.end(req.method === 'HEAD' ? undefined : body);
  }

  /** The handler response protocol: a page, { redirect, flash }, { status, html }, { json }, { download }, { body, type } or nothing when the handler wrote the response itself. */
  function respond(ctx, out) {
    const { req, res } = ctx;
    if (res.writableEnded || res.headersSent) return;
    if (out === undefined || out === null) {
      if (res.getHeader('content-type')) return;
      throw new Error(`No response from ${req.method} ${ctx.path}`);
    }
    if (typeof out === 'string' || isSafe(out)) return sendHtml(ctx, 200, toHtml(out));
    if (out.redirect) return sendRedirect(ctx, out.redirect, out.flash, out.status);
    if (out.json !== undefined) return sendJson(ctx, out.status || 200, out.json);
    if (out.download) return sendDownload(ctx, out.download);
    if (out.html !== undefined) return sendHtml(ctx, out.status || 200, toHtml(out.html));
    if (out.body !== undefined) return sendBody(ctx, out);
    throw new Error(`Unknown response from ${req.method} ${ctx.path}`);
  }

  function sameSitePath(req) {
    const ref = req.headers.referer;
    if (!ref) return null;
    try {
      const u = new URL(ref);
      if (u.origin !== baseOrigin && u.host !== req.headers.host) return null;
      return u.pathname + u.search;
    } catch {
      return null;
    }
  }

  function respondError(ctx, err) {
    const { req, res } = ctx;
    const known = err instanceof HttpError;
    const status = known ? err.status : 500;
    if (!known || status >= 500) log.error?.(err);
    if (res.headersSent || res.writableEnded) {
      try {
        res.end();
      } catch {
        // The connection is already closed.
      }
      return;
    }
    const message = known ? err.message : 'Something went wrong on our side. Please try again.';
    if (ctx.isApi) return sendJson(ctx, status, { error: message, ...(err.details?.fieldErrors ? { fieldErrors: err.details.fieldErrors } : {}) });
    if (UNSAFE.has(req.method) && BACK_STATUSES.has(status)) {
      const back = sameSitePath(req);
      if (back) return sendRedirect(ctx, back, { text: message, tone: 'red' });
    }
    if (status === 401) return sendRedirect(ctx, '/login', { text: message, tone: 'orange' });
    let page;
    try {
      page = toHtml(errorPage(ctx, status, message));
    } catch (pageErr) {
      log.error?.(pageErr);
      res.statusCode = status;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end(`${status} ${message}`);
      return;
    }
    sendHtml(ctx, status, page);
  }

  async function handle(req, res) {
    const url = new URL(req.url || '/', 'http://internal');
    const pathname = url.pathname;
    const started = Date.now();
    securityHeaders(res, { https: config.BASE_URL.startsWith('https://') });
    const ctx = {
      req, res, url, path: pathname, query: Object.fromEntries(url.searchParams), params: {}, body: {}, rawBody: null, files: [],
      cookies: parseCookies(req.headers.cookie), user: null, org: null, role: null, session: null, apiKey: null, csrf: '',
      services, definition: def, cache: {}, flash: [], access: null, dryRun: false, ip: clientIp(req, config),
      isApi: pathname === '/api' || pathname.startsWith('/api/'),
    };
    ctx.audit = (action, resource = null, recordId = null, summary = '') => {
      if (!ctx.org) return;
      db.run(
        'INSERT INTO audit (org_id, user_id, action, resource, record_id, summary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        ctx.org.id, ctx.user?.id ?? null, String(action), resource, recordId ?? null, String(summary ?? '').slice(0, 500), nowISO(),
      );
    };
    ctx.can = (role) => roleRank(ctx.role) >= roleRank(role);
    try {
      if (serveStatic(ctx)) return;
      const m = router.match(req.method, pathname);
      if (!m) {
        const allowed = router.allowed(pathname);
        if (allowed.length) {
          res.setHeader('Allow', allowed.join(', '));
          throw new HttpError(405, 'That action is not supported here.');
        }
        if (!ctx.isApi) {
          authenticate(ctx);
          prepareSignedIn(ctx);
        }
        throw new HttpError(404, 'Page not found');
      }
      const { route, params } = m;
      const opts = route.opts || {};
      ctx.params = params;
      if (opts.api) ctx.isApi = true;
      if (!opts.public) {
        if (!ctx.isApi && (req.method === 'GET' || req.method === 'HEAD')) readFlash(ctx);
        authenticate(ctx);
      }
      const inApp = pathname === '/app' || pathname.startsWith('/app/');
      if ((inApp || (ctx.isApi && !opts.public)) && !ctx.user) {
        if (ctx.isApi) throw new HttpError(401, 'Send a valid API key in the Authorization header: Bearer <key>.');
        if (req.method === 'GET' || req.method === 'HEAD') return sendRedirect(ctx, `/login?next=${encodeURIComponent(pathname + url.search)}`);
        return sendRedirect(ctx, '/login', { text: 'Your session has ended. Please log in again.', tone: 'orange' });
      }
      prepareSignedIn(ctx);
      if (!opts.public && !ctx.apiKey && !ctx.session) ctx.csrf = anonCsrf(ctx);
      if (UNSAFE.has(req.method)) {
        await readRequestBody(ctx, opts);
        if (!opts.public && !ctx.apiKey) checkCsrf(ctx);
        if (ctx.org && ctx.access?.readOnly && (inApp || ctx.isApi) && !READ_ONLY_OK.some((re) => re.test(pathname))) {
          throw new HttpError(402, ctx.access.warning || 'This workspace is read only. Choose a plan in Billing to make changes.');
        }
      }
      const out = await route.handler(ctx);
      respond(ctx, out);
    } catch (err) {
      respondError(ctx, err);
    } finally {
      if (config.LOG_REQUESTS) log.info?.(`${req.method} ${pathname} ${res.statusCode} ${Date.now() - started}ms`);
    }
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      log.error?.(err);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end('Internal error');
      }
    });
  });
  server.requestTimeout = 120000;
  server.headersTimeout = 30000;

  function start(port = config.PORT) {
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, () => {
        if (!config.DISABLE_JOBS && options.jobs !== false) services.jobs.start();
        log.info?.(`${def.name} is running at ${config.BASE_URL} (port ${server.address().port})`);
        resolve(server);
      });
    });
  }
  async function close() {
    services.jobs.stop?.();
    if (server.listening) {
      await new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections?.();
      });
    }
    db.close?.();
  }
  /** `node server.js` starts the app. `node server.js --run-jobs` runs the daily jobs once and exits. */
  async function cli(argv = process.argv.slice(2)) {
    if (argv.includes('--run-jobs')) {
      const out = await services.jobs.runDaily();
      log.info?.(JSON.stringify(out));
      db.close?.();
      return out;
    }
    const s = await start();
    const stop = () => close().then(() => process.exit(0));
    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);
    return s;
  }

  return { server, services, router, handle, start, close, cli, config, definition: def };
}
