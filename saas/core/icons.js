// Inline stroke icons (24px grid, drawn with currentColor) for navigation and buttons. Unknown names render nothing.
import { raw } from './ui.js';

const PATHS = {
  dashboard: '<rect x="3.5" y="3.5" width="7" height="8" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="5" rx="1.5"/><rect x="13.5" y="11.5" width="7" height="9" rx="1.5"/><rect x="3.5" y="14.5" width="7" height="6" rx="1.5"/>',
  chase: '<path d="M10 6.5h10M10 12h10M10 17.5h10"/><path d="m3.5 6.5 1.5 1.5 2.5-3"/><path d="m3.5 12 1.5 1.5 2.5-3"/><path d="m3.5 17.5 1.5 1.5 2.5-3"/>',
  invoices: '<path d="M14 3.5H7.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8z"/><path d="M14 3.5V8h4.5"/><path d="M9 13h6M9 16.5h4"/>',
  customers: '<rect x="4.5" y="3.5" width="15" height="17" rx="2"/><path d="M9.5 20.5v-3.5h5v3.5"/><path d="M8.5 7.5h1M14.5 7.5h1M8.5 11h1M14.5 11h1"/>',
  payments: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6 12h.01M18 12h.01"/>',
  chases: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  templates: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.8 6.5 8.2 6 8.2-6"/>',
  reports: '<path d="M3.5 20.5h17"/><path d="M6.5 16.5v-5M11 16.5v-9M15.5 16.5v-6.5M20 16.5V9"/>',
  policy: '<path d="M12 3.2 19.5 6v5.6c0 4.4-3.1 8.1-7.5 9.2-4.4-1.1-7.5-4.8-7.5-9.2V6z"/><path d="m9 12 2.2 2.2L15.5 10"/>',
  guides: '<path d="M3 5.5c2.2-1 5.6-1.2 9 .8 3.4-2 6.8-1.8 9-.8v13.2c-2.2-1-5.6-1.2-9 .8-3.4-2-6.8-1.8-9-.8z"/><path d="M12 6.3v13.2"/>',
  founder: '<path d="m12 3.5 2.5 5.3 5.8.7-4.3 4 1.1 5.7L12 16.4l-5.1 2.8 1.1-5.7-4.3-4 5.8-.7z"/>',
  settings: '<path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17" r="2"/>',
  team: '<circle cx="9" cy="8.5" r="3.2"/><path d="M3 19.5c.7-3.3 3.1-5 6-5s5.3 1.7 6 5"/><path d="M15.5 5.6a3.2 3.2 0 0 1 0 5.8M17.6 14.8c1.8.6 3 2.2 3.4 4.7"/>',
  billing: '<rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M2.5 9.8h19M6 15h4"/>',
  activity: '<path d="M3 12h3.8l2.6-6.5 4.2 13 2.6-6.5H21"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  logout: '<path d="M14.5 4H18a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3.5"/><path d="M10 16.5 5.5 12 10 7.5M5.5 12H15"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
};

export const hasIcon = (name) => Object.hasOwn(PATHS, name);

export function icon(name, { label = null, cls = '' } = {}) {
  if (!hasIcon(name)) return '';
  const a11y = label ? `role="img" aria-label="${String(label).replace(/[<>&"]/g, '')}"` : 'aria-hidden="true" focusable="false"';
  return raw(`<svg class="icon${cls ? ` ${cls}` : ''}" viewBox="0 0 24 24" ${a11y}>${PATHS[name]}</svg>`);
}
