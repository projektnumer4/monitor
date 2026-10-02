/**
 * Konfiguracja z dwóch warstw: plik config/default.json (domyślna) i ustawienia zapisane w bazie przez panel admina.
 * Ustawienia z panelu mają pierwszeństwo, ale źródła i reguły łączymy po identyfikatorze, dzięki czemu nowe źródła
 * dodane w przyszłych wersjach kodu pojawią się u Ciebie same (chyba że usunąłeś je w panelu).
 */
const MERGE_OBJECTS = ['school', 'schedule', 'filter', 'report'];
const REPLACE = ['roles', 'documents', 'watchedActs', 'keywords'];

export function validateConfig(o) {
  const errors = [];
  if (!o || typeof o !== 'object' || Array.isArray(o)) return ['ustawienia nie są obiektem'];
  const arr = (k, check) => {
    if (o[k] === undefined) return;
    if (!Array.isArray(o[k])) return errors.push(`${k}: oczekiwano listy`);
    o[k].forEach((x, i) => { const e = check(x); if (e) errors.push(`${k}[${i}]: ${e}`); });
  };
  arr('roles', (r) => (r && typeof r.name === 'string' && r.name.trim() ? '' : 'brak nazwy'));
  arr('documents', (d) => (d && typeof d.name === 'string' && d.name.trim() ? '' : 'brak nazwy'));
  arr('rules', (r) => (r && typeof r.id === 'string' && ['hi', 'mid', 'lo'].includes(r.prio) ? '' : 'zły identyfikator lub priorytet'));
  arr('sources', (s) => (s && typeof s.id === 'string' && typeof s.type === 'string' ? '' : 'brak id lub typu'));
  if (o.keywords !== undefined && (typeof o.keywords !== 'object' || Array.isArray(o.keywords))) errors.push('keywords: oczekiwano obiektu');
  return errors;
}

const byId = (list) => new Map((list ?? []).map((x) => [x.id, x]));

export function mergeConfig(base, override) {
  if (!override) return base;
  const out = { ...base };
  for (const k of MERGE_OBJECTS) if (override[k]) out[k] = { ...base[k], ...override[k] };
  for (const k of REPLACE) if (override[k] !== undefined) out[k] = override[k];

  const removed = new Set(override.removedSources ?? []);
  if (override.sources) {
    const mine = byId(override.sources);
    out.sources = [...override.sources, ...(base.sources ?? []).filter((s) => !mine.has(s.id) && !removed.has(s.id))];
  }
  if (override.rules) {
    const mine = byId(override.rules);
    out.rules = [...override.rules, ...(base.rules ?? []).filter((r) => !mine.has(r.id))];
  }
  return out;
}
