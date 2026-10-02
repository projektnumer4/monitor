import { stripHtml, truncate } from '../util.js';

const MAX_PDF_BYTES = 6 * 1024 * 1024;

/** Linki z dowolnej strony HTML (np. BIP organu prowadzącego): zwraca {title, url}. */
export function parseLinks(html, pageUrl) {
  const out = [];
  const re = /<a\s[^>]*href\s*=\s*["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(String(html)))) {
    const title = stripHtml(m[2]).replace(/\s+/g, ' ').trim();
    if (!title) continue;
    try {
      const u = new URL(m[1].trim(), pageUrl);
      if (!/^https?:$/.test(u.protocol)) continue;
      out.push({ title, url: u.href });
    } catch { /* niepoprawny adres */ }
  }
  return out;
}

/**
 * Ogólne źródło "lista linków na stronie" dla serwisów bez RSS (BIP gminy lub powiatu, strony komunikatów).
 * Strony takie nie podają dat, więc przy pierwszym uruchomieniu silnik tylko ZAPAMIĘTUJE istniejące linki
 * (baseline), a zgłasza dopiero nowe, które pojawią się później.
 */
export function createLinksSource(def) {
  const include = def.include ? new RegExp(def.include, 'i') : null;
  const exclude = def.exclude ? new RegExp(def.exclude, 'i') : null;
  const minLen = def.minTitleLength ?? 15;
  return {
    id: def.id,
    name: def.name,
    baseline: true,

    async listNew(ctx) {
      const html = await ctx.http.text(def.url, { headers: { Accept: 'text/html' } });
      const links = parseLinks(html, def.url);
      if (!links.length) throw new Error('Nie znaleziono żadnych linków na stronie (zły adres lub zmiana układu)');
      const seen = new Set();
      const out = [];
      for (const l of links) {
        if (l.title.length < minLen) continue;
        if (include && !include.test(`${l.title} ${l.url}`)) continue;
        if (exclude && exclude.test(`${l.title} ${l.url}`)) continue;
        if (seen.has(l.url)) continue;
        seen.add(l.url);
        out.push({
          key: `link:${def.id}:${l.url}`,
          sourceId: def.id,
          sourceName: def.name,
          kind: 'news',
          title: l.title,
          url: l.url,
          publishedAt: null,
        });
        if (out.length >= (def.maxItems ?? 80)) break;
      }
      return out;
    },

    async enrich(c) {
      return c;
    },

    async loadText(c, ctx) {
      try {
        if (/\.pdf($|\?)/i.test(c.url)) {
          const buf = await ctx.http.buffer(c.url, { headers: { Accept: 'application/pdf' } });
          return buf.length > MAX_PDF_BYTES ? { kind: 'none', note: 'PDF zbyt duży' } : { kind: 'pdf', base64: buf.toString('base64') };
        }
        const text = stripHtml(await ctx.http.text(c.url, { headers: { Accept: 'text/html' } }));
        return text ? { kind: 'text', text: truncate(text, 20000), truncated: text.length > 20000 } : { kind: 'none', note: 'pusta strona' };
      } catch {
        return { kind: 'none', note: 'treść niedostępna' };
      }
    },
  };
}
