export const PRIORITY_LABEL = { hi: 'Wysoki', mid: 'Średni', lo: 'Niski' };
export const PRIORITY_ORDER = { hi: 0, mid: 1, lo: 2 };
export const WORKFLOW_LABEL = { new: 'Nowa', in_progress: 'W toku', done: 'Zrobiona', dismissed: 'Odrzucona' };
export const STATUS_LABEL = { obowiazuje: 'obowiązuje', projekt: 'projekt', wytyczne: 'wytyczne', informacja: 'informacja' };
export const CATEGORY_LABEL = { oswiatowe: 'Prawo oświatowe', administracyjne: 'Prawo administracyjne' };

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Dzisiejsza data w strefie Europe/Warsaw jako YYYY-MM-DD. */
export function todayWarsaw(now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

const utc = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
export const daysBetween = (from, to) => Math.round((utc(to) - utc(from)) / 86400000);
export const addDays = (iso, n) => new Date(utc(iso) + n * 86400000).toISOString().slice(0, 10);

export const plDate = (iso) => (iso ? new Date(`${String(iso).slice(0, 10)}T12:00:00Z`).toLocaleDateString('pl-PL', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '');
export const plDateShort = (iso) => (iso ? new Date(`${String(iso).slice(0, 10)}T12:00:00Z`).toLocaleDateString('pl-PL', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '');
export const plDateTime = (iso) => (iso ? new Date(iso).toLocaleString('pl-PL', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Warsaw' }) : '');

export function deadlineText(effective, today) {
  if (!effective) return 'brak terminu';
  const d = daysBetween(today, String(effective).slice(0, 10));
  if (d < 0) return `obowiązuje od ${plDate(effective)}`;
  if (d === 0) return `wchodzi w życie dzisiaj (${plDate(effective)})`;
  return `za ${d} ${d === 1 ? 'dzień' : 'dni'} (${plDate(effective)})`;
}

export const sortChanges = (list) =>
  [...list].sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || String(b.run_date).localeCompare(String(a.run_date)));

export const pluralZmiana = (n) => {
  const t = n % 10; const h = n % 100;
  return n === 1 ? 'zmiana' : t >= 2 && t <= 4 && !(h >= 12 && h <= 14) ? 'zmiany' : 'zmian';
};

/** Bezpieczny, losowy token (256 bitów) w formacie base64url. */
export function makeToken() {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Skrót SHA-256 (hex): w bazie trzymamy tylko skrót tokenu, nigdy sam token. */
export async function sha256Hex(text) {
  const buf = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const slug = (s) =>
  String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'zrodlo';

export function toast(text, kind = 'ok') {
  const el = globalThis.document?.getElementById('toast');
  if (!el) return;
  el.innerHTML = `<div class="toast" role="status" style="${kind === 'err' ? 'background:var(--hi);color:#fff' : ''}">${esc(text)}</div>`;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { el.innerHTML = ''; }, kind === 'err' ? 4500 : 2200);
}

export const deepClone = (o) => JSON.parse(JSON.stringify(o));
