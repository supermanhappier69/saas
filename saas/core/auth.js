// Accounts, workspaces, sessions, CSRF, invites, password resets and API keys.
import { HttpError, nowISO, randomToken, sha256, hmac, hashPassword, verifyPassword, isEmail, todayISO, addDays } from './util.js';
import { cookie, appendCookie } from './http.js';

export const ROLES = ['viewer', 'member', 'admin', 'owner'];
export const roleRank = (r) => ROLES.indexOf(r) + 1;
export const ROLE_LABELS = { viewer: 'Viewer (read only)', member: 'Member', admin: 'Admin', owner: 'Owner' };

export function clientIp(req, config) {
  if (config?.TRUST_PROXY) {
    const xf = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (xf) return xf;
  }
  return req.socket?.remoteAddress || '';
}

export function createAuth({ db, config, definition }) {
  const SID = `${definition.slug}_sid`;
  const SESSION_DAYS = 30;
  const hooks = { onOrgCreated: null };
  let dummy = null;
  const dummyHash = () => (dummy ||= hashPassword('not-a-real-password'));

  const parseOrg = (o) => {
    if (!o) return null;
    let s = {};
    try { s = JSON.parse(o.settings || '{}'); } catch { s = {}; }
    return { ...o, settings: s };
  };
  const getOrg = (id) => parseOrg(db.get('SELECT * FROM orgs WHERE id = ?', Number(id)));
  const getUser = (id) => db.get('SELECT id, email, name, created_at, last_login FROM users WHERE id = ?', Number(id));
  const membership = (orgId, userId) => db.get('SELECT * FROM memberships WHERE org_id = ? AND user_id = ?', Number(orgId), Number(userId));
  const userOrgs = (userId) => db.all('SELECT o.id, o.name, m.role FROM memberships m JOIN orgs o ON o.id = m.org_id WHERE m.user_id = ? ORDER BY o.name', userId);

  const fieldError = (field, msg, status = 422) => {
    throw new HttpError(status, msg, { fieldErrors: { [field]: msg } });
  };

  function checkPassword(pw, field = 'password') {
    if (typeof pw !== 'string' || pw.length < 8) fieldError(field, 'Use at least 8 characters.');
    if (pw.length > 200) fieldError(field, 'Use 200 characters or fewer.');
    if (/^(.)\1+$/.test(pw)) fieldError(field, 'Choose a less predictable password.');
  }

  function createOrg(name, { isDemo = false } = {}) {
    const trialEnds = addDays(todayISO(), definition.trialDays ?? 14);
    const r = db.run(
      'INSERT INTO orgs (name, plan, plan_status, trial_ends, settings, feed_token, is_demo, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      String(name).slice(0, 120), definition.trialPlan || definition.plans?.[0]?.id || 'trial', 'trialing', trialEnds,
      JSON.stringify(definition.defaultSettings || {}), randomToken(18), isDemo ? 1 : 0, nowISO(),
    );
    const org = getOrg(r.lastInsertRowid);
    hooks.onOrgCreated?.(org);
    return getOrg(org.id);
  }

  function signup({ name, email, password, orgName }, { isDemo = false } = {}) {
    name = String(name || '').trim().slice(0, 120);
    email = String(email || '').trim().toLowerCase();
    orgName = String(orgName || '').trim().slice(0, 120);
    const errors = {};
    if (!name) errors.name = 'Enter your name.';
    if (!isEmail(email)) errors.email = 'Enter a valid email address.';
    if (!orgName) errors.orgName = 'Enter your business name.';
    try { checkPassword(password); } catch (err) { errors.password = err.message; }
    if (Object.keys(errors).length) throw new HttpError(422, 'Please check the highlighted fields.', { fieldErrors: errors });
    if (db.get('SELECT id FROM users WHERE email = ?', email)) fieldError('email', 'An account with this email already exists. Log in instead.', 409);
    return db.tx(() => {
      const u = db.run('INSERT INTO users (email, name, password_hash, created_at) VALUES (?, ?, ?, ?)', email, name, hashPassword(password), nowISO());
      const org = createOrg(orgName, { isDemo });
      db.run('INSERT INTO memberships (org_id, user_id, role, created_at) VALUES (?, ?, ?, ?)', org.id, u.lastInsertRowid, 'owner', nowISO());
      return { user: getUser(u.lastInsertRowid), org: getOrg(org.id) };
    });
  }

  function login(email, password) {
    const u = db.get('SELECT * FROM users WHERE email = ?', String(email || '').trim().toLowerCase());
    if (!u) {
      verifyPassword(String(password || ''), dummyHash());
      return null;
    }
    return verifyPassword(String(password || ''), u.password_hash) ? getUser(u.id) : null;
  }

  const defaultOrgFor = (userId) => db.get('SELECT org_id FROM memberships WHERE user_id = ? ORDER BY id LIMIT 1', userId)?.org_id || null;

  function startSession(req, res, userId, orgId) {
    const token = randomToken(32);
    const now = Date.now();
    db.run(
      'INSERT INTO sessions (token_hash, user_id, org_id, created_at, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)',
      sha256(token), userId, orgId, new Date(now).toISOString(), new Date(now + SESSION_DAYS * 86400000).toISOString(),
      clientIp(req, config), String(req.headers['user-agent'] || '').slice(0, 200),
    );
    db.run('UPDATE users SET last_login = ? WHERE id = ?', nowISO(), userId);
    appendCookie(res, cookie(SID, token, { maxAge: SESSION_DAYS * 86400, secure: config.SECURE_COOKIES }));
    return token;
  }

  function loadSession(cookies) {
    const token = cookies[SID];
    if (!token) return null;
    const s = db.get('SELECT * FROM sessions WHERE token_hash = ?', sha256(token));
    if (!s) return null;
    if (s.expires_at < nowISO()) {
      db.run('DELETE FROM sessions WHERE id = ?', s.id);
      return null;
    }
    const user = getUser(s.user_id);
    const org = getOrg(s.org_id);
    const m = user && org ? membership(org.id, user.id) : null;
    if (!m) return null;
    return { session: s, user, org, role: m.role };
  }

  function endSession(cookies, res) {
    const token = cookies[SID];
    if (token) db.run('DELETE FROM sessions WHERE token_hash = ?', sha256(token));
    appendCookie(res, cookie(SID, '', { maxAge: 0, secure: config.SECURE_COOKIES }));
  }

  function switchOrg(session, orgId) {
    if (!membership(Number(orgId), session.user_id)) throw new HttpError(403, 'You are not a member of that workspace.');
    db.run('UPDATE sessions SET org_id = ? WHERE id = ?', Number(orgId), session.id);
  }

  const csrfFor = (session) => hmac(config.APP_SECRET, 'csrf:' + session.token_hash);

  function createToken(kind, { userId = null, orgId = null, email = null, role = null, data = null, hours = 1 } = {}) {
    const token = randomToken(24);
    db.run(
      'INSERT INTO tokens (kind, token_hash, user_id, org_id, email, role, data, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      kind, sha256(token), userId, orgId, email, role, data ? JSON.stringify(data) : null, new Date(Date.now() + hours * 3600000).toISOString(), nowISO(),
    );
    return token;
  }
  function findToken(kind, token) {
    const t = db.get('SELECT * FROM tokens WHERE kind = ? AND token_hash = ?', kind, sha256(String(token || '')));
    if (!t || t.used_at || t.expires_at < nowISO()) return null;
    return t;
  }
  const useToken = (id) => db.run('UPDATE tokens SET used_at = ? WHERE id = ?', nowISO(), id);

  function invite({ orgId, email, role, invitedBy }) {
    email = String(email || '').trim().toLowerCase();
    if (!isEmail(email)) fieldError('email', 'Enter a valid email address.');
    if (!ROLES.includes(role) || role === 'owner') fieldError('role', 'Choose a role.');
    const existing = db.get('SELECT u.id FROM users u JOIN memberships m ON m.user_id = u.id WHERE m.org_id = ? AND u.email = ?', orgId, email);
    if (existing) fieldError('email', 'This person is already in your workspace.', 409);
    db.run("UPDATE tokens SET used_at = ? WHERE kind = 'invite' AND org_id = ? AND email = ? AND used_at IS NULL", nowISO(), orgId, email);
    return createToken('invite', { orgId, email, role, userId: invitedBy, hours: 24 * 7 });
  }

  function acceptInvite(token, { name, password }) {
    const t = findToken('invite', token);
    if (!t) throw new HttpError(410, 'This invitation has expired or has already been used. Ask for a new one.');
    return db.tx(() => {
      let user = db.get('SELECT * FROM users WHERE email = ?', t.email);
      if (user) {
        if (!verifyPassword(String(password || ''), user.password_hash)) fieldError('password', 'That password is not correct for this account.', 401);
      } else {
        const n = String(name || '').trim().slice(0, 120);
        if (!n) fieldError('name', 'Enter your name.');
        checkPassword(password);
        const r = db.run('INSERT INTO users (email, name, password_hash, created_at) VALUES (?, ?, ?, ?)', t.email, n, hashPassword(password), nowISO());
        user = { id: r.lastInsertRowid };
      }
      if (!membership(t.org_id, user.id)) db.run('INSERT INTO memberships (org_id, user_id, role, created_at) VALUES (?, ?, ?, ?)', t.org_id, user.id, t.role || 'member', nowISO());
      useToken(t.id);
      return { user: getUser(user.id), org: getOrg(t.org_id), role: t.role };
    });
  }

  function requestReset(email) {
    const u = db.get('SELECT id, email, name FROM users WHERE email = ?', String(email || '').trim().toLowerCase());
    if (!u) return null;
    return { user: u, token: createToken('reset', { userId: u.id, email: u.email, hours: 1 }) };
  }

  function resetPassword(token, password) {
    const t = findToken('reset', token);
    if (!t) throw new HttpError(410, 'This reset link has expired or has already been used. Request a new one.');
    checkPassword(password);
    db.tx(() => {
      db.run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(password), t.user_id);
      db.run('DELETE FROM sessions WHERE user_id = ?', t.user_id);
      useToken(t.id);
    });
    return getUser(t.user_id);
  }

  function changePassword(userId, current, next) {
    const u = db.get('SELECT * FROM users WHERE id = ?', userId);
    if (!u || !verifyPassword(String(current || ''), u.password_hash)) fieldError('current', 'Your current password is not correct.', 401);
    checkPassword(next, 'password');
    db.run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(next), userId);
  }

  function createApiKey(orgId, userId, name) {
    const raw = `${definition.slug}_${randomToken(24)}`;
    db.run('INSERT INTO api_keys (org_id, user_id, name, prefix, key_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      orgId, userId, String(name || 'API key').slice(0, 80), raw.slice(0, definition.slug.length + 7), sha256(raw), nowISO());
    return raw;
  }
  const revokeApiKey = (orgId, id) => db.run('UPDATE api_keys SET revoked_at = ? WHERE org_id = ? AND id = ? AND revoked_at IS NULL', nowISO(), orgId, Number(id));

  function authenticateApiKey(header) {
    const m = /^Bearer\s+(\S+)$/i.exec(String(header || ''));
    if (!m) return null;
    const k = db.get('SELECT * FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL', sha256(m[1]));
    if (!k) return null;
    const user = getUser(k.user_id);
    const org = getOrg(k.org_id);
    const mem = user && org ? membership(org.id, user.id) : null;
    if (!mem) return null;
    db.run('UPDATE api_keys SET last_used = ? WHERE id = ?', nowISO(), k.id);
    return { user, org, role: mem.role, apiKey: k };
  }

  return {
    SID, hooks, getOrg, getUser, membership, userOrgs, createOrg, signup, login, defaultOrgFor,
    startSession, loadSession, endSession, switchOrg, csrfFor, createToken, findToken, useToken,
    invite, acceptInvite, requestReset, resetPassword, changePassword, createApiKey, revokeApiKey,
    authenticateApiKey, checkPassword,
  };
}
