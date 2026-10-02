import { addDays, stripHtml, truncate } from '../util.js';

const BASE = 'https://api.sejm.gov.pl/eli';
const MAX_TEXT_CHARS = 70000;
const MAX_PDF_BYTES = 6 * 1024 * 1024;

/**
 * Dziennik Ustaw i Monitor Polski przez publiczne API ELI Sejmu.
 * Lista aktów w roku -> filtr po dacie publikacji -> szczegóły aktu -> tekst (HTML lub PDF).
 */
export function createEliSource(def) {
  const publisher = def.publisher;

  async function fetchYear(http, year) {
    const all = [];
    const seen = new Set();
    let offset = 0;
    for (let page = 0; page < 20; page++) {
      const url = `${BASE}/acts/${publisher}/${year}${offset ? `?offset=${offset}&limit=500` : ''}`;
      const res = await http.json(url);
      const items = res.items ?? [];
      const fresh = items.filter((i) => !seen.has(i.ELI));
      fresh.forEach((i) => seen.add(i.ELI));
      all.push(...fresh);
      const total = res.totalCount ?? res.count ?? all.length;
      if (!fresh.length || all.length >= total) break;
      offset = all.length;
    }
    return all;
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
          // Rok, w którym dziennik jeszcze nic nie opublikował (np. początek stycznia), nie jest błędem.
          if (e.status === 404) continue;
          throw e;
        }
        for (const i of items) {
          const published = (i.promulgation || i.announcementDate || '').slice(0, 10);
          if (!published || published < cutoff || published > addDays(ctx.today, 1)) continue;
          out.push({
            key: i.ELI,
            sourceId: def.id,
            sourceName: def.name,
            kind: 'act',
            title: i.title,
            url: `https://eli.gov.pl/eli/${i.ELI}/ogl`,
            publishedAt: published,
            type: i.type,
            display: i.displayAddress,
            publisher: i.publisher,
            year: i.year,
            pos: i.pos,
            textHTML: Boolean(i.textHTML),
            textPDF: Boolean(i.textPDF),
          });
        }
      }
      return out;
    },

    async enrich(c, ctx) {
      const d = await ctx.http.json(`${BASE}/acts/${c.publisher}/${c.year}/${c.pos}`);
      const refs = d.references ?? {};
      return {
        ...c,
        effectiveDate: d.entryIntoForce ? String(d.entryIntoForce).slice(0, 10) : null,
        issuer: (d.releasedBy ?? []).join('; '),
        keywords: [...(d.keywords ?? []), ...(d.keywordsNames ?? [])],
        changedActs: (refs['Akty zmienione'] ?? []).map((x) => x.id),
        legalStatus: d.status ?? c.status,
        textHTML: c.textHTML || Boolean(d.textHTML),
        textPDF: c.textPDF || Boolean(d.textPDF),
      };
    },

    async loadText(c, ctx) {
      const base = `${BASE}/acts/${c.publisher}/${c.year}/${c.pos}`;
      if (c.textHTML) {
        const html = await ctx.http.text(`${base}/text.html`, { headers: { Accept: 'text/html' } });
        const text = stripHtml(html);
        return { kind: 'text', text: truncate(text, MAX_TEXT_CHARS), truncated: text.length > MAX_TEXT_CHARS };
      }
      if (c.textPDF) {
        const buf = await ctx.http.buffer(`${base}/text.pdf`, { headers: { Accept: 'application/octet-stream' } });
        if (buf.length > MAX_PDF_BYTES) return { kind: 'none', note: `PDF zbyt duży (${Math.round(buf.length / 1048576)} MB), analiza tylko na podstawie metadanych` };
        return { kind: 'pdf', base64: buf.toString('base64') };
      }
      return { kind: 'none', note: 'brak tekstu aktu w API' };
    },
  };
}
