// Workspace pages: settings, sample data, API keys, data export, deleting a workspace, your account and switching workspaces.
import { HttpError, isEmail, nowISO, parseBool, parseMoney, parseNumber, todayISO } from './util.js';
import { html, button, postButton, pageHeader, card, recordForm, alert, csrfField, table, badge } from './ui.js';
import { appPage } from './layout.js';
import { requireRole, can, fmtWhen } from './crud.js';
import { apiRow } from './api.js';
import { ROLE_LABELS } from './auth.js';

export const BUSINESS_FIELDS = [
  { key: 'company_name', label: 'Business name', type: 'text', max: 160, help: 'As it should appear on emails and letters.', group: 'Your business' },
  { key: 'sender_name', label: 'Your name', type: 'text', max: 120, help: 'Used to sign emails and letters.', group: 'Your business' },
  { key: 'reply_to', label: 'Reply-to email', type: 'email', help: 'Replies to emails sent from the app go here.', group: 'Your business' },
  { key: 'phone', label: 'Phone', type: 'phone', max: 40, group: 'Your business' },
  { key: 'address', label: 'Business address', type: 'textarea', max: 600, rows: 3, group: 'Your business' },
];
export const settingsFields = (def) => def.settingsFields || BUSINESS_FIELDS;
const NUMERIC = ['money', 'number', 'percent', 'int'];
const MAX_WORKSPACES = 10;
const optionValues = (ctx, f) => (ctx.services.resources.options(f, ctx) || []).map((o) => String(o && typeof o === 'object' ? o.value : o));
const show = (v) => (Array.isArray(v) ? v.join(', ') : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : v ?? '');

/** Validates settings input against simple field definitions. Returns { values, errors }. */
export function cleanSettings(ctx, fields, body = {}) {
  const values = {};
  const errors = {};
  for (const f of fields) {
    const raw = body[f.key];
    if (f.type === 'bool') {
      values[f.key] = parseBool(raw) === true;
      continue;
    }
    if (f.type === 'multiselect') {
      const allowed = optionValues(ctx, f);
      const list = (Array.isArray(raw) ? raw : [raw]).filter((x) => x !== undefined && x !== null && x !== '').map(String);
      if (list.some((x) => !allowed.includes(x))) errors[f.key] = `Choose from: ${allowed.join(', ')}`;
      else if (f.required && !list.length) errors[f.key] = f.requiredMessage || 'Choose at least one.';
      values[f.key] = list;
      continue;
    }
    const v = String(raw ?? '').trim();
    if (!v) {
      if (f.required) errors[f.key] = f.requiredMessage || `Enter ${f.label.toLowerCase()}.`;
      values[f.key] = NUMERIC.includes(f.type) ? null : '';
      continue;
    }
    if (f.type === 'email') {
      if (!isEmail(v)) errors[f.key] = 'Enter a valid email address.';
      values[f.key] = v.toLowerCase();
    } else if (f.type === 'url') {
      if (!/^https?:\/\/[^\s<>"]+$/i.test(v)) errors[f.key] = 'Enter a web address starting with https://';
      values[f.key] = v;
    } else if (NUMERIC.includes(f.type)) {
      const n = f.type === 'money' ? parseMoney(v) : parseNumber(v);
      const bad = typeof n !== 'number' || Number.isNaN(n) || (f.type === 'int' && !Number.isInteger(n));
      if (bad) errors[f.key] = f.type === 'int' ? 'Enter a whole number.' : 'Enter a number.';
      else if (f.min !== undefined && n < f.min) errors[f.key] = `Enter ${f.min} or more.`;
      else if (f.max !== undefined && n > f.max) errors[f.key] = `Enter ${f.max} or less.`;
      values[f.key] = bad ? null : n;
    } else if (f.type === 'select') {
      const allowed = optionValues(ctx, f);
      if (!allowed.includes(v)) errors[f.key] = `Choose one of: ${allowed.join(', ')}`;
      values[f.key] = v;
    } else {
      const max = f.max || (f.type === 'textarea' || f.type === 'markdown' ? 4000 : 300);
      if (v.length > max) errors[f.key] = `Use ${max} characters or fewer.`;
      values[f.key] = v;
    }
  }
  return { values, errors };
}

function settingsPage(ctx, { values = null, errors = {}, newKey = null, confirmError = null } = {}) {
  const { resources, db, config } = ctx.services;
  const tz = config?.TIMEZONE;
  const isAdmin = can(ctx, 'admin');
  const fields = [{ key: 'org_name', label: 'Workspace name', type: 'text', required: true, max: 120, group: 'Workspace' }, ...settingsFields(ctx.definition)];
  const current = values || { org_name: ctx.org.name, ...ctx.org.settings };
  const general = isAdmin
    ? recordForm(ctx, { action: '/app/settings', fields, values: current, errors, submit: 'Save settings' })
    : html`${alert('Only workspace admins can change these settings.', 'blue')}<dl class="details">${fields.map((f) => html`<div class="detail"><dt>${f.label}</dt><dd class="pre-line">${show(current[f.key]) || '—'}</dd></div>`)}</dl>`;
  const samples = resources.sampleCount(ctx.org.id);
  const sampleCard = samples && isAdmin
    ? card({ title: 'Sample data', body: html`<p>This workspace has ${samples} fictional SAMPLE record${samples === 1 ? '' : 's'} to help you explore. Removing them keeps everything you added yourself.</p>${postButton(ctx, '/app/settings/remove-samples', 'Remove sample data', { confirm: 'Remove all SAMPLE records? This cannot be undone.' })}` })
    : '';
  let apiCard = '';
  if (isAdmin) {
    const keys = db.all('SELECT k.id, k.name, k.prefix, k.created_at, k.last_used, k.revoked_at, u.name AS who FROM api_keys k LEFT JOIN users u ON u.id = k.user_id WHERE k.org_id = ? ORDER BY k.id DESC LIMIT 50', ctx.org.id);
    const keyTable = table({
      columns: [
        { key: 'name', label: 'Name', render: (k) => k.name || 'API key' },
        { key: 'prefix', label: 'Key', render: (k) => html`<code>${k.prefix}…</code>` },
        { key: 'who', label: 'Created by', render: (k) => k.who || '—' },
        { key: 'last_used', label: 'Last used', render: (k) => (k.last_used ? fmtWhen(k.last_used, tz) : html`<span class="muted">Never</span>`) },
        { key: 'id', label: '', align: 'right', render: (k) => (k.revoked_at ? badge('Revoked', 'gray') : postButton(ctx, `/app/settings/api-keys/${k.id}/revoke`, 'Revoke', { size: 'sm', variant: 'ghost', confirm: 'Revoke this key? Anything using it will stop working.' })) },
      ],
      rows: keys,
      empty: html`<p class="muted">No API keys yet.</p>`,
    });
    const fresh = newKey
      ? alert(html`Copy this key now. It won't be shown again.<br><code class="secret" id="new-key">${newKey}</code> <button type="button" class="btn btn-secondary btn-sm" data-copy-target="#new-key">Copy</button>`, 'green', 'API key created.')
      : '';
    const form = html`<form method="post" action="/app/settings/api-keys" class="inline-fields">${csrfField(ctx)}<label class="sr-only" for="key-name">Key name</label><input id="key-name" name="name" placeholder="Key name, e.g. Zapier" maxlength="60" required>${button('Create API key', { size: 'sm' })}</form>`;
    apiCard = card({ title: 'API keys', body: html`${fresh}<p class="muted">Connect other tools with the JSON API at <code>/api/v1</code>, sending the header <code>Authorization: Bearer &lt;key&gt;</code>. A key acts with the role of the person who created it.</p>${keyTable}${form}` });
  }
  const exportCard = isAdmin
    ? card({ title: 'Export your data', body: html`<p>Download everything in this workspace as one JSON file, or each list as a CSV that opens in Excel or Google Sheets.</p><p>${button('Download all data (JSON)', { href: '/app/settings/export.json', size: 'sm' })}</p><ul class="link-list">${resources.all.map((r) => html`<li><a href="/app/${r.name}/export.csv">${r.label} (CSV)</a></li>`)}</ul>` })
    : '';
  const dangerCard = can(ctx, 'owner')
    ? card({
      title: 'Delete workspace',
      cls: 'card-danger',
      body: html`<p>This permanently deletes <strong>${ctx.org.name}</strong> with all its records, files and team access. Export your data first if you might need it, and cancel any subscription in Billing.</p><form method="post" action="/app/settings/delete" class="form" data-confirm="Delete this workspace permanently?">${csrfField(ctx)}<div class="${confirmError ? 'field has-error' : 'field'}"><label for="confirm-name">Type the workspace name to confirm</label><input id="confirm-name" name="confirm" autocomplete="off" required>${
        confirmError ? html`<p class="field-error">${confirmError}</p>` : ''
      }</div><div class="form-actions">${button('Delete workspace', { variant: 'danger' })}</div></form>`,
    })
    : '';
  return appPage(ctx, {
    title: 'Settings',
    active: 'settings',
    body: html`${pageHeader({ title: 'Settings', subtitle: 'Details used across the app, in emails and on letters.' })}${card({ title: 'Workspace details', body: general })}${sampleCard}${apiCard}${exportCard}${dangerCard}`,
  });
}

function accountPage(ctx, { errors = {}, pwErrors = {}, values = {} } = {}) {
  const orgs = ctx.services.auth.userOrgs(ctx.user.id);
  const profile = recordForm(ctx, {
    action: '/app/account',
    fields: [{ key: 'name', label: 'Your name', type: 'text', required: true, max: 120, autocomplete: 'name' }],
    values: { name: values.name ?? ctx.user.name },
    errors,
    submit: 'Save',
  });
  const password = recordForm(ctx, {
    action: '/app/account/password',
    fields: [
      { key: 'current', label: 'Current password', type: 'text', inputType: 'password', required: true, autocomplete: 'current-password' },
      { key: 'password', label: 'New password', type: 'text', inputType: 'password', required: true, autocomplete: 'new-password', help: 'At least 8 characters.' },
      { key: 'confirm', label: 'Repeat new password', type: 'text', inputType: 'password', required: true, autocomplete: 'new-password' },
    ],
    values: {},
    errors: pwErrors,
    submit: 'Change password',
  });
  const workspaces = table({
    columns: [
      { key: 'name', label: 'Workspace' },
      { key: 'role', label: 'Your role', render: (o) => ROLE_LABELS[o.role] || o.role },
      { key: 'id', label: '', align: 'right', render: (o) => (o.id === ctx.org.id ? badge('Current', 'green') : html`<form method="post" action="/app/switch" class="inline-form">${csrfField(ctx)}<input type="hidden" name="org" value="${o.id}">${button('Switch', { size: 'sm' })}</form>`) },
    ],
    rows: orgs,
  });
  const create = orgs.length < MAX_WORKSPACES && !ctx.org.is_demo
    ? html`<form method="post" action="/app/account/workspaces" class="inline-fields">${csrfField(ctx)}<label class="sr-only" for="ws-name">New workspace name</label><input id="ws-name" name="name" placeholder="New workspace name" maxlength="120" required>${button('Create workspace', { size: 'sm' })}</form>`
    : '';
  const devices = html`<p class="muted">Signed in somewhere else, like a shared computer? Sign those devices out without affecting this one.</p>${postButton(ctx, '/app/account/sessions', 'Sign out other devices', { size: 'sm', confirm: 'Sign out all other devices?' })}`;
  return appPage(ctx, {
    title: 'Your account',
    active: 'account',
    body: html`${pageHeader({ title: 'Your account', subtitle: ctx.user.email })}${card({ title: 'Profile', body: profile })}${card({ title: 'Password', body: password })}${card({ title: 'Workspaces', body: html`${workspaces}${create}` })}${card({ title: 'Devices', body: devices })}`,
  });
}

export function registerWorkspace(router) {
  router.get('/app/settings', (ctx) => settingsPage(ctx));
  router.post('/app/settings', (ctx) => {
    requireRole(ctx, 'admin');
    const { values, errors } = cleanSettings(ctx, settingsFields(ctx.definition), ctx.body);
    for (const [k, msg] of Object.entries(ctx.definition.validateSettings?.(values, ctx) || {})) errors[k] ??= msg;
    const name = String(ctx.body.org_name || '').trim().slice(0, 120);
    if (!name) errors.org_name = 'Enter a workspace name.';
    if (Object.keys(errors).length) return { status: 422, html: settingsPage(ctx, { values: { ...ctx.body }, errors }) };
    ctx.services.db.run('UPDATE orgs SET name = ?, settings = ? WHERE id = ?', name, JSON.stringify({ ...ctx.org.settings, ...values }), ctx.org.id);
    ctx.audit?.('settings', null, null, 'Workspace settings updated');
    return { redirect: '/app/settings', flash: 'Settings saved.' };
  });
  router.post('/app/settings/remove-samples', (ctx) => {
    requireRole(ctx, 'admin');
    const { removed: n, kept } = ctx.services.resources.removeSamples(ctx);
    const keptNote = kept ? ` Kept ${kept} that your own records use, as normal ${kept === 1 ? 'record' : 'records'}: rename ${kept === 1 ? 'it' : 'them'} or move your records first.` : '';
    return { redirect: '/app', flash: n || kept ? `Removed ${n} sample record${n === 1 ? '' : 's'}.${keptNote}` : 'There were no sample records to remove.' };
  });
  router.post('/app/settings/api-keys', (ctx) => {
    requireRole(ctx, 'admin');
    if (ctx.org.is_demo) throw new HttpError(403, 'API keys are turned off in the demo workspace.');
    const name = String(ctx.body.name || '').trim().slice(0, 60) || 'API key';
    const key = ctx.services.auth.createApiKey(ctx.org.id, ctx.user.id, name);
    ctx.audit?.('api_key', null, null, `API key “${name}” created`);
    return settingsPage(ctx, { newKey: key });
  });
  router.post('/app/settings/api-keys/:id/revoke', (ctx) => {
    requireRole(ctx, 'admin');
    const r = ctx.services.auth.revokeApiKey(ctx.org.id, Number(ctx.params.id));
    if (r?.changes) ctx.audit?.('api_key', null, null, 'API key revoked');
    return { redirect: '/app/settings', flash: r?.changes ? 'API key revoked.' : 'That key was already revoked.' };
  });
  router.get('/app/settings/export.json', (ctx) => {
    requireRole(ctx, 'admin');
    const { resources, config } = ctx.services;
    const data = {
      product: ctx.definition.name,
      exported_at: nowISO(),
      workspace: { id: ctx.org.id, name: ctx.org.name, plan: ctx.org.plan, plan_status: ctx.org.plan_status, settings: ctx.org.settings },
      resources: {},
    };
    for (const r of resources.all) data.resources[r.name] = resources.query(ctx, r, { all: true }).rows.map((row) => apiRow(r, row));
    ctx.audit?.('export', null, null, 'Exported all workspace data (JSON)');
    return { download: { body: JSON.stringify(data, null, 2), type: 'application/json; charset=utf-8', filename: `${ctx.definition.slug}-export-${todayISO(config?.TIMEZONE)}.json` } };
  });
  router.post('/app/settings/delete', (ctx) => {
    requireRole(ctx, 'owner');
    if (String(ctx.body.confirm || '').trim() !== String(ctx.org.name).trim()) {
      return { status: 422, html: settingsPage(ctx, { confirmError: 'That does not match the workspace name.' }) };
    }
    const { auth } = ctx.services;
    const name = ctx.org.name;
    const other = auth.userOrgs(ctx.user.id).find((o) => o.id !== ctx.org.id);
    if (other) auth.switchOrg(ctx.session, other.id);
    ctx.services.deleteOrg(ctx.org.id);
    if (other) return { redirect: '/app', flash: `Workspace “${name}” was deleted.` };
    auth.endSession(ctx.cookies, ctx.res);
    return { redirect: '/', flash: `Workspace “${name}” was deleted.` };
  });
  router.post('/app/switch', (ctx) => {
    if (!ctx.session) throw new HttpError(400, 'Sign in to switch workspaces.');
    ctx.services.auth.switchOrg(ctx.session, ctx.body.org);
    return { redirect: '/app' };
  });
  router.get('/app/account', (ctx) => accountPage(ctx));
  router.post('/app/account', (ctx) => {
    const name = String(ctx.body.name || '').trim().slice(0, 120);
    if (!name) return { status: 422, html: accountPage(ctx, { errors: { name: 'Enter your name.' }, values: ctx.body }) };
    ctx.services.db.run('UPDATE users SET name = ? WHERE id = ?', name, ctx.user.id);
    return { redirect: '/app/account', flash: 'Profile saved.' };
  });
  router.post('/app/account/password', (ctx) => {
    const { current, password, confirm } = ctx.body;
    if (password !== confirm) return { status: 422, html: accountPage(ctx, { pwErrors: { confirm: 'The new passwords do not match.' } }) };
    try {
      ctx.services.auth.changePassword(ctx.user.id, current, password);
    } catch (err) {
      if (err instanceof HttpError && err.details?.fieldErrors) return { status: 422, html: accountPage(ctx, { pwErrors: err.details.fieldErrors }) };
      throw err;
    }
    if (ctx.session) ctx.services.db.run('DELETE FROM sessions WHERE user_id = ? AND id != ?', ctx.user.id, ctx.session.id);
    ctx.audit?.('account', null, null, `${ctx.user.name} changed their password`);
    return { redirect: '/app/account', flash: 'Password changed. Any other devices have been signed out.' };
  });
  router.post('/app/account/workspaces', (ctx) => {
    if (ctx.org.is_demo) throw new HttpError(403, 'Create your own account to add workspaces.');
    const { auth, db } = ctx.services;
    if (auth.userOrgs(ctx.user.id).length >= MAX_WORKSPACES) throw new HttpError(409, `You can belong to up to ${MAX_WORKSPACES} workspaces.`);
    const name = String(ctx.body.name || '').trim().slice(0, 120);
    if (!name) return { redirect: '/app/account', flash: { text: 'Enter a name for the new workspace.', tone: 'red' } };
    const org = db.tx(() => {
      const o = auth.createOrg(name);
      db.run("INSERT INTO memberships (org_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)", o.id, ctx.user.id, nowISO());
      return o;
    });
    if (ctx.session) auth.switchOrg(ctx.session, org.id);
    return { redirect: '/app', flash: `Workspace “${org.name}” created, with a ${ctx.definition.trialDays ?? 14}-day free trial.` };
  });
  router.post('/app/account/sessions', (ctx) => {
    const n = ctx.session ? ctx.services.db.run('DELETE FROM sessions WHERE user_id = ? AND id != ?', ctx.user.id, ctx.session.id).changes : 0;
    return { redirect: '/app/account', flash: n ? `Signed out ${n} other session${n === 1 ? '' : 's'}.` : 'No other devices were signed in.' };
  });
}
