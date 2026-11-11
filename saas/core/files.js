// File attachments stored on local disk (DATA_DIR/uploads). Swap for object storage behind the same interface.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { HttpError, nowISO, randomToken } from './util.js';

const ALLOWED = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.odt': 'application/vnd.oasis.opendocument.text',
  '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
  '.eml': 'message/rfc822',
};

const MAGIC = {
  '.pdf': (b) => b.subarray(0, 4).toString('latin1') === '%PDF',
  '.png': (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  '.jpg': (b) => b[0] === 0xff && b[1] === 0xd8,
  '.jpeg': (b) => b[0] === 0xff && b[1] === 0xd8,
  '.gif': (b) => b.subarray(0, 3).toString('latin1') === 'GIF',
};

export function createFiles({ db, config }) {
  const root = path.join(config.DATA_DIR, 'uploads');
  const maxMb = Number(config.MAX_UPLOAD_MB) || 10;
  const maxBytes = maxMb * 1024 * 1024;

  const get = (orgId, id) => db.get('SELECT * FROM files WHERE org_id = ? AND id = ?', orgId, Number(id));
  const list = (orgId, resource, recordId) => db.all(
    'SELECT f.*, u.name AS uploaded_by FROM files f LEFT JOIN users u ON u.id = f.created_by WHERE f.org_id = ? AND f.resource = ? AND f.record_id = ? ORDER BY f.id DESC',
    orgId, resource, Number(recordId),
  );

  function save({ orgId, userId = null, resource = null, recordId = null, filename, data }) {
    const name = String(filename || 'file').replace(/[\u0000-\u001f\\/:*?"<>|]+/g, '_').slice(-120) || 'file';
    const ext = path.extname(name).toLowerCase();
    if (!ALLOWED[ext]) throw new HttpError(415, "That file type isn't supported. Upload a PDF, image, Word, Excel, CSV or text file.");
    if (!data?.length) throw new HttpError(422, 'The file is empty.');
    if (data.length > maxBytes) throw new HttpError(413, `Files must be ${maxMb} MB or smaller.`);
    if (MAGIC[ext] && !MAGIC[ext](data)) throw new HttpError(415, `That file doesn't look like a real ${ext.slice(1).toUpperCase()} file.`);
    const key = `${orgId}/${randomToken(18)}`;
    const full = path.join(root, key);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, data, { mode: 0o600 });
    const r = db.run(
      'INSERT INTO files (org_id, resource, record_id, name, mime, size, storage_key, sha256, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      orgId, resource, recordId, name, ALLOWED[ext], data.length, key, crypto.createHash('sha256').update(data).digest('hex'), userId, nowISO(),
    );
    return get(orgId, r.lastInsertRowid);
  }

  function remove(orgId, id) {
    const f = get(orgId, id);
    if (!f) return null;
    try { fs.unlinkSync(path.join(root, f.storage_key)); } catch { /* already gone */ }
    db.run('DELETE FROM files WHERE id = ?', f.id);
    return f;
  }

  function removeFor(orgId, resource, recordId) {
    for (const f of list(orgId, resource, recordId)) remove(orgId, f.id);
  }

  function stream(res, f, { inline = false } = {}) {
    const full = path.join(root, f.storage_key);
    if (!fs.existsSync(full)) throw new HttpError(404, 'This file is missing from storage.');
    const safeInline = inline && /^(application\/pdf|image\/(png|jpeg|gif|webp))$/.test(f.mime);
    res.statusCode = 200;
    res.setHeader('Content-Type', f.mime || 'application/octet-stream');
    res.setHeader('Content-Length', f.size);
    res.setHeader('Content-Disposition', `${safeInline ? 'inline' : 'attachment'}; filename="${f.name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(f.name)}`);
    res.setHeader('Cache-Control', 'private, no-store');
    fs.createReadStream(full).pipe(res);
  }

  const removeOrg = (orgId) => fs.rmSync(path.join(root, String(orgId)), { recursive: true, force: true });

  return { save, get, list, remove, removeFor, stream, removeOrg, maxBytes, maxMb, root, ALLOWED };
}
