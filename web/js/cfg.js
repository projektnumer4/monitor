// Łączenie ustawień z panelu z domyślnymi. Musi działać identycznie jak src/config.js po stronie silnika
// (test web/test/cfg-parity.test.js pilnuje zgodności).
const MERGE_OBJECTS = ['school', 'schedule', 'filter', 'report', 'drafts'];
const REPLACE = ['roles', 'documents', 'watchedActs', 'keywords'];
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
  if (override.removedSources) out.removedSources = override.removedSources;
  return out;
}

/** Zapisujemy w bazie tylko to, co panel faktycznie edytuje. */
export function persistable(cfg) {
  const { school, roles, documents, rules, sources, keywords, removedSources } = cfg;
  return { school, roles, documents, rules, sources, keywords, removedSources: removedSources ?? [] };
}
