import { XMLParser } from 'fast-xml-parser';
import { addDays, isoOrNull, stripHtml, truncate } from '../util.js';

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text' });

const text = (v) => (v == null ? '' : typeof v === 'object' ? String(v['#text'] ?? '') : String(v));
const arr = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

function linkOf(item) {
  const l = item.link;
  if (typeof l === 'string') return l;
  const first = arr(l)[0];
  return first?.['@_href'] ?? text(first) ?? '';
}

function toIsoDate(raw) {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? isoOrNull(raw) : d.toISOString().slice(0, 10);
}

/** Wyciąga temat z podstrony typu BIP ("w sprawie: ..."). Zwraca pusty tekst, gdy go nie ma. */
export function extractSubject(text) {
  const m = String(text).match(/w sprawie\W{0,4}([^\n]{5,500})/i);
  return m ? m[1].replace(/\s+/g, ' ').trim() : '';
}

/** Parsuje RSS 2.0 i Atom do jednolitej listy. */
export function parseFeed(xml) {
  const doc = parser.parse(xml);
  const items = doc?.rss?.channel?.item ?? doc?.feed?.entry ?? doc?.['rdf:RDF']?.item ?? [];
  return arr(items).map((it) => ({
    title: stripHtml(text(it.title)),
    link: linkOf(it).trim(),
    guid: text(it.guid || it.id).trim(),
    date: toIsoDate(text(it.pubDate || it.published || it.updated || it['dc:date'])),
    summary: stripHtml(text(it.description || it.summary || it['content:encoded'] || it.content)),
  }));
}

/** Kanał RSS/Atom (komunikaty MEN, kuratorium, BIP). */
export function createRssSource(def) {
  return {
    id: def.id,
    name: def.name,

    async listNew(ctx) {
      const cutoff = addDays(ctx.today, -ctx.lookbackDays);
      const xml = await ctx.http.text(def.url, { headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' } });
      return parseFeed(xml)
        .filter((i) => i.title && i.link && (!i.date || i.date >= cutoff))
        .map((i) => ({
          key: `rss:${def.id}:${i.guid || i.link}`,
          sourceId: def.id,
          sourceName: def.name,
          kind: 'news',
          title: i.title,
          url: i.link,
          publishedAt: i.date,
          summary: truncate(i.summary, 1500),
        }));
    },

    /**
     * Niektóre BIP-y (np. Urzędu Miasta Ostrołęki) podają w kanale tylko numer zarządzenia, a temat jest na jego stronie.
     * Przy detailWhenEmpty pobieramy ją dla pozycji bez opisu, żeby filtr miał z czego ocenić trafność.
     */
    async enrich(c, ctx) {
      if (!def.detailWhenEmpty || c.summary) return c;
      try {
        const subject = extractSubject(stripHtml(await ctx.http.text(c.url, { headers: { Accept: 'text/html' } })));
        return subject ? { ...c, summary: subject } : c;
      } catch {
        return c; // strona niedostępna: zostaje sam tytuł, pozycja nie jest tracona
      }
    },

    async loadText(c, ctx) {
      let body = '';
      try {
        body = stripHtml(await ctx.http.text(c.url, { headers: { Accept: 'text/html' } }));
      } catch {
        /* strona może być niedostępna, wtedy zostaje samo streszczenie z kanału */
      }
      const joined = [c.summary, body].filter(Boolean).join('\n\n');
      return joined ? { kind: 'text', text: truncate(joined, 20000), truncated: joined.length > 20000 } : { kind: 'none', note: 'brak treści' };
    },
  };
}
