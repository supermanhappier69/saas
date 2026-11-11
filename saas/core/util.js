// Shared helpers for the Opus SaaS products. No third-party dependencies.
import crypto from 'node:crypto';

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const nowISO = () => new Date().toISOString();

/** Today's date (YYYY-MM-DD) in the app time zone. APP_TODAY pins the date for tests and demos. */
export function todayISO(tz = process.env.APP_TIMEZONE || 'Europe/London', date) {
  if (date === undefined && process.env.APP_TODAY && isISODate(process.env.APP_TODAY)) return process.env.APP_TODAY;
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date || new Date());
}

export function isISODate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

const utc = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};

/** Whole days from a to b (b - a). Both are YYYY-MM-DD. */
export function daysBetween(a, b) {
  return Math.round((utc(b) - utc(a)) / 86400000);
}

export function addDays(iso, n) {
  return new Date(utc(iso) + n * 86400000).toISOString().slice(0, 10);
}

/** Adds calendar months, clamping to the last day of the month (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = total - ny * 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${String(ny).padStart(4, '0')}-${String(nm + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

export const minDate = (...ds) => ds.filter(Boolean).sort()[0] || null;
export const maxDate = (...ds) => ds.filter(Boolean).sort().slice(-1)[0] || null;

export function round2(n) {
  const x = Number(n) || 0;
  return Math.round((x + (x >= 0 ? Number.EPSILON : -Number.EPSILON)) * 100) / 100;
}

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
export const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
export const hmac = (secret, s) => crypto.createHmac('sha256', String(secret)).update(String(s)).digest('base64url');

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(pw), salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(pw, stored) {
  try {
    const parts = String(stored || '').split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const [, N, r, p, saltB64, hashB64] = parts;
    const expected = Buffer.from(hashB64, 'base64');
    const got = crypto.scryptSync(String(pw), Buffer.from(saltB64, 'base64'), expected.length, { N: Number(N), r: Number(r), p: Number(p) });
    return crypto.timingSafeEqual(got, expected);
  } catch {
    return false;
  }
}

export function safeEqual(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y) && String(a).length === String(b).length;
}

export const isEmail = (s) => typeof s === 'string' && s.length <= 254 && /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]{2,}$/.test(s);

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
export const e = escapeHtml;

const GBP = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });
export function fmtGBP(n) {
  if (n === null || n === undefined || n === '' || Number.isNaN(Number(n))) return '';
  return GBP.format(round2(n));
}

export function fmtNumber(n, dp = 0) {
  if (n === null || n === undefined || n === '' || Number.isNaN(Number(n))) return '';
  return new Intl.NumberFormat('en-GB', { minimumFractionDigits: dp, maximumFractionDigits: dp }).format(Number(n));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export function fmtDateUK(iso, long = false) {
  if (!isISODate(iso)) return iso ? String(iso) : '';
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${(long ? MONTHS_LONG : MONTHS)[m - 1]} ${y}`;
}
export const monthLabel = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
};

function monthIndex(name) {
  return ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(String(name).slice(0, 3).toLowerCase());
}

/** Parses ISO, UK day-first (31/01/2026, 31-1-26) and written dates (31 Jan 2026). Returns null if empty, undefined if invalid. */
export function parseFlexibleDate(input) {
  if (input === null || input === undefined) return null;
  const s = String(input).trim();
  if (!s) return null;
  const mk = (y, mo, d) => {
    const iso = `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    return isISODate(iso) ? iso : undefined;
  };
  let m;
  if ((m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ].*)?$/.exec(s))) return mk(+m[1], +m[2], +m[3]);
  if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(s))) {
    let y = +m[3];
    if (y < 100) y += 2000;
    return mk(y, +m[2], +m[1]);
  }
  if ((m = /^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})$/.exec(s))) {
    const mi = monthIndex(m[2]);
    if (mi >= 0) return mk(+m[3], mi + 1, +m[1]);
  }
  if ((m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/.exec(s))) {
    const mi = monthIndex(m[1]);
    if (mi >= 0) return mk(+m[3], mi + 1, +m[2]);
  }
  return undefined;
}

/** "£1,250.50", "(20)", "-5" → number. null if empty, undefined if invalid. */
export function parseMoney(input) {
  if (input === null || input === undefined) return null;
  if (typeof input === 'number') return Number.isFinite(input) ? round2(input) : undefined;
  let s = String(input).trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/^GBP/i, '').replace(/[£$€\s,]/g, '');
  if (s.startsWith('-')) {
    neg = !neg;
    s = s.slice(1);
  }
  if (!/^\d+(\.\d+)?$/.test(s) && !/^\.\d+$/.test(s)) return undefined;
  const v = round2(Number(s));
  return neg ? -v : v;
}

export function parseNumber(input) {
  if (input === null || input === undefined) return null;
  if (typeof input === 'number') return Number.isFinite(input) ? input : undefined;
  const s = String(input).trim().replace(/,/g, '').replace(/%$/, '');
  if (!s) return null;
  if (!/^-?(\d+(\.\d+)?|\.\d+)$/.test(s)) return undefined;
  return Number(s);
}

/** Returns true, false, or null when the value isn't recognisable. Empty counts as false. */
export function parseBool(input) {
  if (input === true || input === false) return input;
  if (input === null || input === undefined) return false;
  const s = String(input).trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'on', '✓', '✔', 'x', 'checked', '__yes__'].includes(s)) return true;
  if (['false', '0', 'no', 'n', 'off', '', '__no__'].includes(s)) return false;
  return null;
}

/** RFC 4180 CSV parser. Detects comma, semicolon or tab delimiters. Skips blank lines. */
export function parseCSV(text) {
  let s = String(text || '');
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  const firstLine = s.split(/\r?\n/, 1)[0] || '';
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let inQ = false;
  for (const ch of firstLine) {
    if (ch === '"') inQ = !inQ;
    else if (!inQ && ch in counts) counts[ch]++;
  }
  const delim = counts['\t'] > counts[','] && counts['\t'] >= counts[';'] ? '\t' : counts[';'] > counts[','] ? ';' : ',';
  const rows = [];
  let row = [];
  let field = '';
  let q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else q = false;
      } else field += c;
    } else if (c === '"' && field === '') q = true;
    else if (c === delim) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
}

/** CSV writer with spreadsheet formula-injection protection. */
export function toCSV(header, rows) {
  const cell = (v) => {
    if (v === null || v === undefined) return '';
    let s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

/** Replaces [Merge field] tokens (case-insensitive). Unknown or empty fields stay in brackets so gaps are visible. */
export function renderMerge(template, vars) {
  const map = new Map(Object.entries(vars || {}).map(([k, v]) => [k.toLowerCase(), v]));
  return String(template || '').replace(/\[([^[\]\n]{1,60})\]/g, (all, key) => {
    const v = map.get(key.trim().toLowerCase());
    return v === undefined || v === null || v === '' ? all : String(v);
  });
}

export function slugify(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

export function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj && Object.prototype.hasOwnProperty.call(obj, k)) out[k] = obj[k];
  return out;
}

export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
export const sum = (arr, f = (x) => x) => round2(arr.reduce((acc, x) => acc + (Number(f(x)) || 0), 0));

export function groupBy(arr, f) {
  const m = new Map();
  for (const x of arr) {
    const k = f(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}

export { mdToHtml } from './markdown.js';
