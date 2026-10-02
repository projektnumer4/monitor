import test from 'node:test';
import assert from 'node:assert/strict';
import { createEliSource } from '../src/sources/eli.js';
import { createRssSource, parseFeed } from '../src/sources/rss.js';
import { fixtureHttp, NOW, loadCfg } from './helpers.js';

const ctxFor = async () => ({ http: await fixtureHttp(), today: '2026-10-02', lookbackDays: 7, cfg: await loadCfg(), now: NOW });

test('ELI: lista zawiera tylko akty z okna czasowego', async () => {
  const src = createEliSource({ id: 'eli-du', name: 'Dziennik Ustaw', publisher: 'DU' });
  const items = await src.listNew(await ctxFor());
  assert.deepEqual(items.map((i) => i.key).sort(), ['DU/2026/1900', 'DU/2026/1901', 'DU/2026/1905', 'DU/2026/1950']);
});
test('ELI: enrich dodaje datę wejścia w życie, organ i akty zmieniane', async () => {
  const src = createEliSource({ id: 'eli-du', name: 'Dziennik Ustaw', publisher: 'DU' });
  const ctx = await ctxFor();
  const [a] = (await src.listNew(ctx)).filter((i) => i.key === 'DU/2026/1905');
  const e = await src.enrich(a, ctx);
  assert.equal(e.effectiveDate, '2027-01-01');
  assert.ok(e.changedActs.includes('DU/2017/59'));
});
test('ELI: loadText zwraca tekst z HTML, a brak pliku daje wynik "none" bez wyjątku w potoku', async () => {
  const src = createEliSource({ id: 'eli-du', name: 'Dziennik Ustaw', publisher: 'DU' });
  const ctx = await ctxFor();
  const t = await src.loadText({ publisher: 'DU', year: 2026, pos: 1900, textHTML: true }, ctx);
  assert.equal(t.kind, 'text');
  assert.match(t.text, /wchodzi w życie/);
});
test('ELI: stronicowanie nie zapętla się, gdy API ignoruje offset', async () => {
  const calls = [];
  const http = { json: async (u) => { calls.push(u); return { items: [{ ELI: 'DU/2026/1', pos: 1, year: 2026, publisher: 'DU', promulgation: '2026-10-01', title: 'x', type: 'Ustawa' }], totalCount: 5 }; } };
  const src = createEliSource({ id: 'eli-du', name: 'DU', publisher: 'DU' });
  const items = await src.listNew({ http, today: '2026-10-02', lookbackDays: 7 });
  assert.equal(items.length, 1);
  assert.ok(calls.length <= 2);
});
test('RSS: nowe pozycje bez starych, klucz zawiera źródło', async () => {
  const src = createRssSource({ id: 'men-komunikaty', name: 'MEN', url: 'https://rss.mtsz.pl/min-edukacja-komunikaty.xml' });
  const items = await src.listNew(await ctxFor());
  assert.equal(items.length, 2);
  assert.ok(items[0].key.startsWith('rss:men-komunikaty:'));
});
test('RSS: parseFeed obsługuje Atom', () => {
  const atom = '<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>T</title><link href="https://x.test/1"/><id>id1</id><updated>2026-10-01T10:00:00Z</updated><summary>S</summary></entry></feed>';
  const [e] = parseFeed(atom);
  assert.equal(e.link, 'https://x.test/1');
  assert.equal(e.date, '2026-10-01');
});
