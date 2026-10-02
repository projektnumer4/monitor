import { addDays, stripHtml } from '../util.js';

const lower = (s) => String(s ?? '').toLowerCase();

const toIso = (dmy) => {
  const m = String(dmy).match(/(\d{2})-(\d{2})-(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

/** Wiersze tabeli listy projektów RCL: tytuł (z linkiem), wnioskodawca, numer, data utworzenia, data zmiany. */
export function parseRclList(html, pageUrl) {
  const rows = [];
  for (const tr of String(html).match(/<tr[\s\S]*?<\/tr>/gi) ?? []) {
    const a = tr.match(/<a\s[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!a) continue;
    const title = stripHtml(a[2]).replace(/\s+/g, ' ').trim();
    const cells = (tr.match(/<td[\s\S]*?<\/td>/gi) ?? []).map((c) => stripHtml(c).replace(/\s+/g, ' ').trim());
    const created = toIso((tr.match(/\b\d{2}-\d{2}-\d{4}\b/) ?? [])[0]);
    if (!title || !created) continue;
    let url;
    try { url = new URL(a[1], pageUrl).href; } catch { continue; }
    rows.push({ title, url, created, applicant: cells.length > 1 ? cells[1] : '' });
  }
  return rows;
}

/**
 * Rządowy Proces Legislacyjny (RCL): projekty rozporządzeń i ustaw na etapie rządowym, czyli najwcześniejszy sygnał.
 * RCL nie ma oficjalnego API ani RSS, więc czytamy publiczne strony HTML (wynik wyszukiwania po tytule).
 * Gdy układ strony się zmieni, źródło zgłosi błąd w raporcie, zamiast po cichu nic nie zwracać.
 */
export function createRclSource(def) {
  const template = def.urlTemplate || 'https://legislacja.rcl.gov.pl/lista?title={q}';
  const queries = def.queries?.length ? def.queries : ['Edukacji', 'oświat', 'szkoł', 'nauczyciel', 'uczni'];
  return {
    id: def.id,
    name: def.name,

    async listNew(ctx) {
      const cutoff = addDays(ctx.today, -ctx.lookbackDays);
      const out = new Map();
      let parsedAny = false;
      for (const q of queries) {
        const url = template.replace('{q}', encodeURIComponent(q));
        const html = await ctx.http.text(url, { headers: { Accept: 'text/html' } });
        const rows = parseRclList(html, url);
        if (rows.length) parsedAny = true;
        for (const r of rows) {
          if (r.created < cutoff) continue;
          const key = `rcl:${new URL(r.url).pathname}${new URL(r.url).search}`;
          if (out.has(key)) continue;
          out.set(key, {
            key,
            sourceId: def.id,
            sourceName: def.name,
            kind: 'draft',
            title: r.title,
            issuer: r.applicant,
            url: r.url,
            publishedAt: r.created,
          });
        }
      }
      if (!parsedAny) throw new Error('Nie rozpoznano żadnych wierszy na stronach RCL (możliwa zmiana układu strony)');
      return [...out.values()];
    },

    async enrich(c) {
      return c;
    },

    async loadText(c, ctx) {
      try {
        const text = stripHtml(await ctx.http.text(c.url, { headers: { Accept: 'text/html' } }));
        return text ? { kind: 'text', text: text.slice(0, 20000), truncated: text.length > 20000 } : { kind: 'none', note: 'pusta strona projektu' };
      } catch {
        return { kind: 'none', note: 'strona projektu niedostępna' };
      }
    },
  };
}
