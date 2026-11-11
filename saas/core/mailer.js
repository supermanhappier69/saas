// Transactional email with an outbox. Providers: Resend, Postmark, or 'log' (stored in the outbox only, for development).
import { nowISO, escapeHtml } from './util.js';

export function createMailer({ db, config, definition, log = console }) {
  const provider = config.RESEND_API_KEY ? 'resend' : config.POSTMARK_TOKEN ? 'postmark' : 'log';
  const from = config.MAIL_FROM || `${definition.name} <no-reply@example.com>`;

  const textToHtml = (text) => `<div style="font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#2C2C2B">${
    escapeHtml(text).split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('')
  }</div>`;

  async function deliver(id) {
    const m = db.get('SELECT * FROM outbox WHERE id = ?', id);
    if (!m) return 'missing';
    if (provider === 'log') {
      db.run("UPDATE outbox SET status = 'logged', provider = 'log', sent_at = ? WHERE id = ?", nowISO(), id);
      return 'logged';
    }
    try {
      let res;
      let body;
      const cc = m.cc ? m.cc.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
      if (provider === 'resend') {
        res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${config.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from, to: [m.to_addr], cc, reply_to: m.reply_to || undefined, subject: m.subject, text: m.body_text, html: m.body_html || textToHtml(m.body_text) }),
          signal: AbortSignal.timeout(15000),
        });
        body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.message || `Resend error ${res.status}`);
        db.run("UPDATE outbox SET status = 'sent', provider = 'resend', provider_id = ?, sent_at = ?, error = NULL WHERE id = ?", body.id || null, nowISO(), id);
      } else {
        res = await fetch('https://api.postmarkapp.com/email', {
          method: 'POST',
          headers: { 'X-Postmark-Server-Token': config.POSTMARK_TOKEN, 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ From: from, To: m.to_addr, Cc: m.cc || undefined, ReplyTo: m.reply_to || undefined, Subject: m.subject, TextBody: m.body_text, HtmlBody: m.body_html || textToHtml(m.body_text), MessageStream: 'outbound' }),
          signal: AbortSignal.timeout(15000),
        });
        body = await res.json().catch(() => ({}));
        if (!res.ok || body.ErrorCode) throw new Error(body.Message || `Postmark error ${res.status}`);
        db.run("UPDATE outbox SET status = 'sent', provider = 'postmark', provider_id = ?, sent_at = ?, error = NULL WHERE id = ?", body.MessageID || null, nowISO(), id);
      }
      return 'sent';
    } catch (err) {
      db.run("UPDATE outbox SET status = 'failed', provider = ?, error = ? WHERE id = ?", provider, String(err.message || err).slice(0, 500), id);
      log.error?.(`[mail] delivery failed for #${id}: ${err.message || err}`);
      return 'failed';
    }
  }

  /** Queues and delivers an email. Returns { id, status }, or { duplicate: true } when dedupeKey was already used. */
  async function send({ orgId = null, to, cc = null, replyTo = null, subject, text, html = null, related = null, dedupeKey = null }) {
    if (dedupeKey && db.get('SELECT id FROM outbox WHERE dedupe_key = ?', dedupeKey)) return { duplicate: true };
    const demo = orgId ? Boolean(db.get('SELECT is_demo FROM orgs WHERE id = ?', orgId)?.is_demo) : false;
    const r = db.run(
      'INSERT INTO outbox (org_id, to_addr, cc, reply_to, subject, body_text, body_html, status, related, dedupe_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      orgId, String(to), cc, replyTo, String(subject).slice(0, 300), String(text), html, demo ? 'logged' : 'queued', related, dedupeKey, nowISO(),
    );
    if (demo) {
      db.run("UPDATE outbox SET provider = 'demo', error = ? WHERE id = ?", 'Demo workspace: emails are never sent.', r.lastInsertRowid);
      return { id: r.lastInsertRowid, status: 'logged', demo: true };
    }
    const status = await deliver(r.lastInsertRowid);
    return { id: r.lastInsertRowid, status };
  }

  return { send, deliver, provider, from };
}
