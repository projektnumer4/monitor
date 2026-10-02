import { addDays } from '../util.js';

const API = 'https://api.sejm.gov.pl/sejm';
const MAX_PDF_BYTES = 6 * 1024 * 1024;

/**
 * Druki sejmowe (projekty ustaw rządowe, poselskie, senackie, prezydenckie) przez oficjalne API Sejmu.
 * To wczesny sygnał: projekt ustawy pojawia się tu na długo przed publikacją w Dzienniku Ustaw.
 */
export function createSejmPrintsSource(def) {
  const term = def.term ?? 10;
  return {
    id: def.id,
    name: def.name,

    async listNew(ctx) {
      const cutoff = addDays(ctx.today, -ctx.lookbackDays);
      const prints = await ctx.http.json(`${API}/term${term}/prints`);
      return (Array.isArray(prints) ? prints : [])
        .filter((p) => {
          const d = String(p.deliveryDate || p.documentDate || '').slice(0, 10);
          return d && d >= cutoff;
        })
        .map((p) => ({
          key: `sejm:t${term}:druk:${p.number}`,
          sourceId: def.id,
          sourceName: def.name,
          kind: 'bill',
          title: p.title,
          display: `Druk sejmowy nr ${p.number}`,
          url: `https://www.sejm.gov.pl/Sejm${term}.nsf/druk.xsp?nr=${encodeURIComponent(p.number)}`,
          publishedAt: String(p.deliveryDate || p.documentDate).slice(0, 10),
          printNumber: p.number,
          attachments: p.attachments ?? [],
        }));
    },

    async enrich(c) {
      return c;
    },

    async loadText(c, ctx) {
      const pdf = (c.attachments ?? []).find((a) => /\.pdf$/i.test(a));
      if (!pdf) return { kind: 'none', note: 'druk bez załącznika PDF' };
      const buf = await ctx.http.buffer(`${API}/term${term}/prints/${encodeURIComponent(c.printNumber)}/${encodeURIComponent(pdf)}`, { headers: { Accept: 'application/pdf' } });
      if (buf.length > MAX_PDF_BYTES) return { kind: 'none', note: `PDF zbyt duży (${Math.round(buf.length / 1048576)} MB), analiza tylko na podstawie tytułu` };
      return { kind: 'pdf', base64: buf.toString('base64') };
    },
  };
}
