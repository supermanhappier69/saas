// Test helpers: start a product app on a random port with a temporary data folder, plus a small HTTP client with a cookie jar and CSRF handling.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../core/app.js';

export const quietLog = { info() {}, warn() {}, error() {}, log() {} };

export function testDefinition(extra = {}) {
  return {
    slug: 'testapp',
    name: 'TestApp',
    tagline: 'A product used by the core tests',
    description: 'Keeps track of contacts.',
    trialDays: 14,
    trialPlan: 'pro',
    plans: [
      { id: 'starter', name: 'Starter', price: 19, description: 'For one person', features: ['Up to 5 contacts'], limits: { contacts: 5, seats: 2 } },
      { id: 'pro', name: 'Pro', price: 49, featured: true, description: 'For small teams', features: ['Unlimited contacts'], limits: { seats: 10 } },
    ],
    resources: [
      {
        name: 'contacts',
        label: 'Contacts',
        singular: 'Contact',
        limitKey: 'contacts',
        fields: [
          { key: 'name', label: 'Name', type: 'text', required: true },
          { key: 'email', label: 'Email', type: 'email' },
          { key: 'stage', label: 'Stage', type: 'select', options: ['Lead', 'Customer'] },
          { key: 'value', label: 'Value', type: 'money' },
        ],
      },
    ],
    ...extra,
  };
}

export function client(base) {
  const jar = new Map();
  const state = { csrf: '' };
  function store(res) {
    for (const c of res.headers.getSetCookie()) {
      const pair = c.split(';')[0];
      const i = pair.indexOf('=');
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1).trim();
      if (!value || /Max-Age=0(;|$)/i.test(c)) jar.delete(name);
      else jar.set(name, value);
    }
  }
  async function request(method, p, { form = null, json, headers = {}, body: rawBody } = {}) {
    const h = { ...headers };
    if (jar.size) h.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    let body;
    if (form) {
      body = new URLSearchParams({ _csrf: state.csrf, ...form }).toString();
      h['content-type'] = 'application/x-www-form-urlencoded';
    } else if (json !== undefined) {
      body = JSON.stringify(json);
      h['content-type'] = 'application/json';
    } else if (rawBody !== undefined) {
      body = rawBody;
    }
    const res = await fetch(base + p, { method, headers: h, body, redirect: 'manual' });
    store(res);
    const text = await res.text();
    const m = text.match(/name="_csrf" value="([^"]+)"/);
    if (m) state.csrf = m[1];
    return { status: res.status, headers: res.headers, text, location: res.headers.get('location'), json: () => JSON.parse(text) };
  }
  return {
    jar,
    state,
    request,
    get: (p, o) => request('GET', p, o),
    post: (p, form = {}, o = {}) => request('POST', p, { ...o, form }),
    api: (method, p, key, json) => request(method, p, { json, headers: key ? { authorization: `Bearer ${key}` } : {} }),
  };
}

export async function startTestApp({ definition = testDefinition(), env = {}, options = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'saas-test-'));
  const app = createApp(definition, {
    inheritEnv: false,
    env: { DATA_DIR: dir, APP_SECRET: 'test-secret-for-core-tests-only', ALLOW_FAKE_BILLING: '1', ...env },
    log: quietLog,
    jobs: false,
    ...options,
  });
  await app.start(0);
  const base = `http://127.0.0.1:${app.server.address().port}`;
  return {
    app,
    base,
    dir,
    services: app.services,
    db: app.services.db,
    client: () => client(base),
    async stop() {
      await app.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Pulls a token out of the latest email of one kind sent to an address, for example /reset/<token> or /invite/<token>. */
export function tokenFromOutbox(db, to, kind) {
  const m = db.get('SELECT body_text FROM outbox WHERE to_addr = ? AND related = ? ORDER BY id DESC LIMIT 1', to, kind);
  const found = m?.body_text?.match(new RegExp(`/${kind}/([A-Za-z0-9_-]+)`));
  return found ? found[1] : null;
}
