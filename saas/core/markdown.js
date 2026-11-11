// Small, safe Markdown renderer for templates, SOPs and help text.
// Everything is escaped first; only http(s), mailto, relative and anchor links are kept.
import { escapeHtml } from './util.js';

function inline(s) {
  let t = escapeHtml(s);
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?=[^*\w]|$)/g, '$1<em>$2</em>');
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text, url) => {
    const u = url.replace(/&amp;/g, '&');
    if (!/^(https?:\/\/|mailto:|\/|#)/i.test(u)) return text;
    const ext = /^https?:/i.test(u);
    return `<a href="${escapeHtml(u)}"${ext ? ' rel="noopener noreferrer" target="_blank"' : ''}>${text}</a>`;
  });
  return t;
}

const LIST_RE = /^(\s*)([-*]|\d+[.)])\s+(.*)$/;

function parseList(lines, i) {
  const items = [];
  while (i < lines.length) {
    const l = lines[i];
    const m = LIST_RE.exec(l);
    if (m) {
      items.push({ indent: m[1].replace(/\t/g, '    ').length, ordered: /\d/.test(m[2]), text: m[3] });
      i++;
      continue;
    }
    if (l.trim() && /^\s{2,}\S/.test(l) && items.length) {
      items[items.length - 1].text += ' ' + l.trim();
      i++;
      continue;
    }
    break;
  }
  let html = '';
  const stack = [];
  for (const it of items) {
    while (stack.length && it.indent < stack[stack.length - 1].indent) html += `</li></${stack.pop().tag}>`;
    const top = stack[stack.length - 1];
    if (!top || it.indent > top.indent) {
      const tag = it.ordered ? 'ol' : 'ul';
      stack.push({ indent: it.indent, tag });
      html += `<${tag}>`;
    } else {
      html += '</li>';
    }
    const task = /^\[( |x|X)\]\s+(.*)$/.exec(it.text);
    if (task) {
      const done = task[1] !== ' ';
      html += `<li class="task${done ? ' done' : ''}"><span class="tick" aria-hidden="true">${done ? '☑' : '☐'}</span> <span class="sr-only">${done ? 'Done: ' : 'To do: '}</span>${inline(task[2])}`;
    } else html += `<li>${inline(it.text)}`;
  }
  while (stack.length) html += `</li></${stack.pop().tag}>`;
  return { html, next: i };
}

function parseTable(lines, i) {
  const rows = [];
  while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
    rows.push(lines[i].trim());
    i++;
  }
  const cells = (r) => r.slice(1, -1).split('|').map((c) => c.trim());
  let body = rows.map(cells);
  let head = null;
  if (body.length > 1 && body[1].every((c) => /^:?-{2,}:?$/.test(c))) {
    head = body[0];
    body = body.slice(2);
  }
  const thead = head ? `<thead><tr>${head.map((c) => `<th scope="col">${inline(c)}</th>`).join('')}</tr></thead>` : '';
  const tbody = `<tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody>`;
  return { html: `<div class="table-wrap"><table class="md-table">${thead}${tbody}</table></div>`, next: i };
}

/** Renders Markdown to HTML. headingOffset 1 maps "#" to <h2> because the page owns <h1>. */
export function mdToHtml(md, { headingOffset = 1 } = {}) {
  const lines = String(md || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;
  const isBlockStart = (l) => /^(#{1,4})\s+/.test(l) || /^>\s?/.test(l) || /^\s*\|.*\|\s*$/.test(l) || LIST_RE.test(l) || /^\s*(---|\*\*\*)\s*$/.test(l);
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    let m;
    if ((m = /^(#{1,4})\s+(.*)$/.exec(line))) {
      const lvl = Math.min(m[1].length + headingOffset, 6);
      out.push(`<h${lvl}>${inline(m[2])}</h${lvl}>`);
      i++;
      continue;
    }
    if (/^\s*(---|\*\*\*)\s*$/.test(line)) {
      out.push('<hr>');
      i++;
      continue;
    }
    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      out.push(`<blockquote>${mdToHtml(buf.join('\n'), { headingOffset })}</blockquote>`);
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const t = parseTable(lines, i);
      out.push(t.html);
      i = t.next;
      continue;
    }
    if (LIST_RE.test(line)) {
      const l = parseList(lines, i);
      out.push(l.html);
      i = l.next;
      continue;
    }
    const buf = [];
    while (i < lines.length && lines[i].trim() && (!buf.length || !isBlockStart(lines[i]))) {
      buf.push(lines[i].trim());
      i++;
    }
    out.push(`<p>${buf.map(inline).join('<br>')}</p>`);
  }
  return out.join('\n');
}
