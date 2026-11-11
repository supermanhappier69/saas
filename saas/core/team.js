// Team page: members, roles, invitations and leaving a workspace.
import { HttpError, nowISO } from './util.js';
import { html, button, postButton, pageHeader, card, table, recordForm, alert, csrfField, attrs } from './ui.js';
import { appPage } from './layout.js';
import { requireRole, can, fmtWhen } from './crud.js';
import { ROLES, ROLE_LABELS } from './auth.js';

export const ROLE_HELP = 'Viewers can see everything but change nothing. Members add and edit records. Admins also manage the team and settings. Owners also manage billing.';
const roleName = (r) => ROLE_LABELS[r] || r;
const members = (db, orgId) => db.all(
  'SELECT u.id, u.name, u.email, u.last_login, m.id AS membership_id, m.role, m.created_at FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.org_id = ? ORDER BY u.name COLLATE NOCASE',
  orgId,
);
const pendingInvites = (db, orgId) => db.all(
  "SELECT id, email, role, created_at, expires_at FROM tokens WHERE kind = 'invite' AND org_id = ? AND used_at IS NULL AND expires_at > ? ORDER BY id DESC",
  orgId, nowISO(),
);
const ownerCount = (db, orgId) => db.get("SELECT COUNT(*) AS n FROM memberships WHERE org_id = ? AND role = 'owner'", orgId).n;

function seatCheck(ctx) {
  const max = ctx.services.billing.limit(ctx.org, 'seats');
  if (!Number.isFinite(max)) return;
  const used = members(ctx.services.db, ctx.org.id).length + pendingInvites(ctx.services.db, ctx.org.id).length;
  if (used >= max) throw new HttpError(402, `Your plan includes up to ${max} team member${max === 1 ? '' : 's'}, counting pending invitations. Upgrade in Billing to add more.`);
}

function revokeKeys(db, orgId, userId) {
  db.run('UPDATE api_keys SET revoked_at = ? WHERE org_id = ? AND user_id = ? AND revoked_at IS NULL', nowISO(), orgId, userId);
}

function teamPage(ctx, { errors = {}, values = {}, notice = '' } = {}) {
  const { db, config } = ctx.services;
  const tz = config?.TIMEZONE;
  const isAdmin = can(ctx, 'admin');
  const isOwner = can(ctx, 'owner');
  const manageable = (m) => isAdmin && m.id !== ctx.user.id && (m.role !== 'owner' || isOwner);
  const roleCell = (m) => {
    if (!manageable(m)) return roleName(m.role);
    const choices = ROLES.filter((r) => r !== 'owner' || isOwner);
    return html`<form method="post" action="/app/team/${m.id}/role" class="inline-fields">${csrfField(ctx)}<label class="sr-only" for="role-${m.id}">Role for ${m.name}</label><select id="role-${m.id}" name="role">${choices.map(
      (r) => html`<option${attrs({ value: r, selected: r === m.role })}>${roleName(r)}</option>`,
    )}</select>${button('Save', { size: 'sm' })}</form>`;
  };
  const memberTable = table({
    columns: [
      { key: 'name', label: 'Name', render: (m) => html`<strong>${m.name}</strong>${m.id === ctx.user.id ? html` <span class="muted">(you)</span>` : ''}<br><span class="muted small">${m.email}</span>` },
      { key: 'role', label: 'Role', render: roleCell },
      { key: 'last_login', label: 'Last signed in', render: (m) => (m.last_login ? fmtWhen(m.last_login, tz) : html`<span class="muted">Never</span>`) },
      { key: 'id', label: '', align: 'right', render: (m) => (manageable(m) ? postButton(ctx, `/app/team/${m.id}/remove`, 'Remove', { size: 'sm', variant: 'ghost', confirm: `Remove ${m.name} from this workspace?` }) : '') },
    ],
    rows: members(db, ctx.org.id),
  });
  const invites = pendingInvites(db, ctx.org.id);
  const inviteCard = invites.length
    ? card({
      title: `Pending invitations (${invites.length})`,
      body: table({
        columns: [
          { key: 'email', label: 'Email' },
          { key: 'role', label: 'Role', render: (i) => roleName(i.role) },
          { key: 'expires_at', label: 'Expires', render: (i) => fmtWhen(i.expires_at, tz) },
          { key: 'id', label: '', align: 'right', render: (i) => (isAdmin ? postButton(ctx, `/app/team/invites/${i.id}/cancel`, 'Cancel', { size: 'sm', variant: 'ghost' }) : '') },
        ],
        rows: invites,
      }),
    })
    : '';
  const inviteForm = isAdmin
    ? card({
      title: 'Invite someone',
      body: recordForm(ctx, {
        action: '/app/team/invite',
        fields: [
          { key: 'email', label: 'Email address', type: 'email', required: true, autocomplete: 'off' },
          { key: 'role', label: 'Role', type: 'select', required: true, help: ROLE_HELP, options: ROLES.filter((r) => r !== 'owner').map((r) => ({ value: r, label: roleName(r) })) },
        ],
        values: { role: 'member', ...values },
        errors,
        submit: 'Send invitation',
      }),
    })
    : '';
  const leave = postButton(ctx, '/app/team/leave', 'Leave workspace', { size: 'sm', variant: 'ghost', confirm: 'Leave this workspace? You will lose access to it.' });
  return appPage(ctx, {
    title: 'Team',
    active: 'team',
    body: html`${pageHeader({ title: 'Team', subtitle: ROLE_HELP, actions: [leave] })}${notice}${card({ title: 'Members', body: memberTable })}${inviteCard}${inviteForm}`,
  });
}

function findMember(ctx, userId) {
  const m = ctx.services.db.get('SELECT * FROM memberships WHERE org_id = ? AND user_id = ?', ctx.org.id, Number(userId));
  if (!m) throw new HttpError(404, 'That person is not in this workspace.');
  return m;
}

export function registerTeam(router) {
  router.get('/app/team', (ctx) => teamPage(ctx));
  router.post('/app/team/invite', async (ctx) => {
    requireRole(ctx, 'admin');
    if (ctx.org.is_demo) throw new HttpError(403, 'Invitations are turned off in the demo workspace.');
    const { auth, mailer, config } = ctx.services;
    const email = String(ctx.body.email || '').trim().toLowerCase();
    const role = String(ctx.body.role || 'member');
    let token;
    try {
      seatCheck(ctx);
      token = auth.invite({ orgId: ctx.org.id, email, role, invitedBy: ctx.user.id });
    } catch (err) {
      if (err instanceof HttpError && err.status < 500) {
        return { status: 422, html: teamPage(ctx, { errors: err.details?.fieldErrors || { _form: err.message }, values: ctx.body }) };
      }
      throw err;
    }
    const def = ctx.definition;
    const link = `${config.BASE_URL}/invite/${token}`;
    const sent = await mailer.send({
      orgId: ctx.org.id,
      to: email,
      replyTo: ctx.user.email,
      subject: `${ctx.user.name} invited you to ${ctx.org.name} on ${def.name}`,
      text: `Hello,\n\n${ctx.user.name} has invited you to join ${ctx.org.name} on ${def.name} as ${roleName(role)}.\n\nAccept the invitation:\n${link}\n\nThe link works for 7 days. If you weren't expecting this, you can ignore this email.\n\n${def.name}`,
      related: 'invite',
    });
    ctx.audit?.('invite', null, null, `Invited ${email} as ${roleName(role)}`);
    if (sent?.status === 'sent') return { redirect: '/app/team', flash: `Invitation sent to ${email}.` };
    const why = sent?.status === 'failed' ? "The invitation email couldn't be sent." : "Email delivery isn't set up yet, so the invitation was not emailed.";
    return teamPage(ctx, {
      notice: alert(html`${why} Share this link with ${email} yourself: <code class="secret" id="invite-link">${link}</code> <button type="button" class="btn btn-secondary btn-sm" data-copy-target="#invite-link">Copy</button>`, 'orange', 'Invitation created.'),
    });
  });
  router.post('/app/team/invites/:id/cancel', (ctx) => {
    requireRole(ctx, 'admin');
    const r = ctx.services.db.run("UPDATE tokens SET used_at = ? WHERE id = ? AND org_id = ? AND kind = 'invite' AND used_at IS NULL", nowISO(), Number(ctx.params.id), ctx.org.id);
    return { redirect: '/app/team', flash: r.changes ? 'Invitation cancelled.' : 'That invitation was already used or cancelled.' };
  });
  router.post('/app/team/leave', (ctx) => {
    const { db, auth } = ctx.services;
    if (ctx.role === 'owner' && ownerCount(db, ctx.org.id) <= 1) {
      throw new HttpError(409, 'You are the only owner. Make someone else an owner first, or delete the workspace in Settings.');
    }
    const name = ctx.org.name;
    ctx.audit?.('team', null, null, `${ctx.user.name} left the workspace`);
    const other = auth.userOrgs(ctx.user.id).find((o) => o.id !== ctx.org.id);
    if (other && ctx.session) auth.switchOrg(ctx.session, other.id);
    db.tx(() => {
      db.run('DELETE FROM memberships WHERE org_id = ? AND user_id = ?', ctx.org.id, ctx.user.id);
      revokeKeys(db, ctx.org.id, ctx.user.id);
    });
    if (other) return { redirect: '/app', flash: `You left ${name}.` };
    auth.endSession(ctx.cookies, ctx.res);
    return { redirect: '/', flash: `You left ${name}.` };
  });
  router.post('/app/team/:userId/role', (ctx) => {
    requireRole(ctx, 'admin');
    const { db, auth } = ctx.services;
    const m = findMember(ctx, ctx.params.userId);
    const role = String(ctx.body.role || '');
    if (!ROLES.includes(role)) throw new HttpError(422, 'Choose a role.');
    if (m.user_id === ctx.user.id) throw new HttpError(403, "You can't change your own role. Ask another admin or owner.");
    if ((m.role === 'owner' || role === 'owner') && !can(ctx, 'owner')) throw new HttpError(403, 'Only an owner can add or change owners.');
    if (m.role === 'owner' && role !== 'owner' && ownerCount(db, ctx.org.id) <= 1) throw new HttpError(409, 'A workspace needs at least one owner.');
    db.run('UPDATE memberships SET role = ? WHERE id = ?', role, m.id);
    const who = auth.getUser(m.user_id)?.name || 'This person';
    ctx.audit?.('team', null, null, `${who} is now ${roleName(role)}`);
    return { redirect: '/app/team', flash: `${who} is now ${roleName(role)}.` };
  });
  router.post('/app/team/:userId/remove', (ctx) => {
    requireRole(ctx, 'admin');
    const { db, auth } = ctx.services;
    const m = findMember(ctx, ctx.params.userId);
    if (m.user_id === ctx.user.id) throw new HttpError(403, 'To leave this workspace, use Leave workspace instead.');
    if (m.role === 'owner' && !can(ctx, 'owner')) throw new HttpError(403, 'Only an owner can remove an owner.');
    const who = auth.getUser(m.user_id)?.name || 'This person';
    db.tx(() => {
      db.run('DELETE FROM memberships WHERE id = ?', m.id);
      db.run('DELETE FROM sessions WHERE user_id = ? AND org_id = ?', m.user_id, ctx.org.id);
      revokeKeys(db, ctx.org.id, m.user_id);
    });
    ctx.audit?.('team', null, null, `${who} was removed from the workspace`);
    return { redirect: '/app/team', flash: `${who} was removed.` };
  });
}
