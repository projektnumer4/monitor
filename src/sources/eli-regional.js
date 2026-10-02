import { addDays } from '../util.js';

const MAX_PDF_BYTES = 6 * 1024 * 1024;
const lower = (s) => String(s ?? '').toLowerCase();

/**
 * Wojewódzki dziennik urzędowy z API zgodnym z ELI (np. Dziennik Urzędowy Województwa Mazowieckiego).
 * Dziennik zawiera uchwały wszystkich gmin i powiatów województwa, więc lista jest zawężana do aktów,
 * w których tytule występuje jeden z terminów `scope` (nazwa organu prowadzącego, wojewoda, sejmik).
 */
export function createEliRegionalSource(def) {
  const base = (def.baseUrl || 'https://edziennik.mazowieckie.pl/api/eli/acts').replace(/\/$/, '');
  const publisher = def.publisher || 'POL_WOJ_MZ';
  const viewBase = (def.viewBaseUrl || 'https://edziennik.mazowieckie.pl/eli').replace(/\/$/, '');
  const scope = (def.scope ?? []).map(lower);

  async function fetchYear(http, year) {
    // Uwaga: serwery dzienników ignorują filtry, a parametr limit potrafi zwracać nieświeże dane,
    // dlatego pobieramy cały rocznik jednym zapytaniem i filtrujemy lokalnie.
    const res = await http.json(`${base}/${publisher}/${year}`);
    const items = Array.isArray(res) ? res : res.items ?? [];
    const total = res.totalCount ?? res.count;
    if (total && items.length < total) {
      const e = new Error(`Dziennik zwrócił ${items.length} z ${total} pozycji rocznika ${year}`);
      e.partial = true;
      throw e;
    }
    return items;
  }

  return {
    id: def.id,
    name: def.name,

    async listNew(ctx) {
      const cutoff = addDays(ctx.today, -ctx.lookbackDays);
      const years = [...new Set([Number(cutoff.slice(0, 4)), Number(ctx.today.slice(0, 4))])];
      const out = [];
      for (const year of years) {
        let items;
        try {
          items = await fetchYear(ctx.http, year);
        } catch (e) {
          if (e.status === 404) continue;
          throw e;
        }
        for (const i of items) {
          const title = i.title ?? '';
          const published = String(i.promulgation || i.announcementDate || i.publicationDate || i.date || '').slice(0, 10);
          const eli = i.ELI || i.eli || i.address || '';
          const pos = i.pos ?? String(eli).split('/').pop();
          if (!title || !published || published < cutoff || published > addDays(ctx.today, 1)) continue;
          if (scope.length && !scope.some((s) => lower(title).includes(s))) continue;
          out.push({
            key: `${publisher}/${i.year ?? year}/${pos}`,
            sourceId: def.id,
            sourceName: def.name,
            kind: 'local',
            title,
            display: `${def.name}, poz. ${pos}`,
            url: `${viewBase}/${publisher}/${i.year ?? year}/${pos}/ogl/pol/pdf`,
            publishedAt: published,
            pos,
            year: i.year ?? year,
          });
        }
      }
      return out;
    },

    async enrich(c) {
      return c;
    },

    async loadText(c, ctx) {
      const buf = await ctx.http.buffer(c.url, { headers: { Accept: 'application/pdf' } });
      if (buf.length > MAX_PDF_BYTES) return { kind: 'none', note: 'PDF zbyt duży, analiza tylko na podstawie tytułu' };
      return { kind: 'pdf', base64: buf.toString('base64') };
    },
  };
}
