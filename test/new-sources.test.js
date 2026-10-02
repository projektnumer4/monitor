import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createSejmPrintsSource } from '../src/sources/sejm.js';
import { createEliRegionalSource } from '../src/sources/eli-regional.js';
import { createRclSource, parseRclList } from '../src/sources/rcl.js';
import { createLinksSource, parseLinks } from '../src/sources/links.js';
import { createRssSource, extractSubject } from '../src/sources/rss.js';
import { buildSources } from '../src/sources/index.js';
import { runScan } from '../src/pipeline.js';
import { createFileStore } from '../src/store/file.js';
import { createMockAnalyzer } from '../src/analyze.js';
import { fixtureHttp, NOW, loadCfg } from './helpers.js';

const ctx = async () => ({ http: await fixtureHttp(), today: '2026-10-02', lookbackDays: 7, cfg: await loadCfg(), now: NOW });

test('Sejm: druki z okna czasowego, jako projekty, z PDF', async () => {
  const src = createSejmPrintsSource({ id: 'sejm-druki', name: 'Sejm', term: 10 });
  const c = await ctx();
  const items = await src.listNew(c);
  assert.deepEqual(items.map((i) => i.printNumber).sort(), ['1234', '1235']);
  assert.equal(items[0].kind, 'bill');
  const t = await src.loadText(items.find((i) => i.printNumber === '1234'), c);
  assert.equal(t.kind, 'pdf');
});

test('Dziennik wojewódzki: tylko akty z zakresu (organ prowadzący), pozostałe pomijane', async () => {
  const cfg = await loadCfg();
  const def = cfg.sources.find((s) => s.id === 'dz-urz-mazowieckie');
  const items = await createEliRegionalSource(def).listNew(await ctx());
  assert.deepEqual(items.map((i) => i.key).sort(), ['POL_WOJ_MZ/2026/9001', 'POL_WOJ_MZ/2026/9003']);
  assert.ok(!items.some((i) => /powiatu ostrołęckiego/i.test(i.title)), 'powiat nie jest organem prowadzącym');
  assert.match(items[0].url, /edziennik\.mazowieckie\.pl\/eli\/POL_WOJ_MZ\/2026\/\d+\/ogl\/pol\/pdf$/);
});

test('Dziennik wojewódzki: niepełny rocznik jest zgłaszany jako błąd, a nie po cichu', async () => {
  const http = { json: async () => ({ items: [{ ELI: 'x/1', title: 'a', promulgation: '2026-10-01' }], totalCount: 500 }) };
  const src = createEliRegionalSource({ id: 'r', name: 'R', publisher: 'P', scope: [] });
  await assert.rejects(src.listNew({ http, today: '2026-10-02', lookbackDays: 7 }), /1 z 500/);
});

test('RCL: parser wierszy tabeli i filtr okna czasowego', async () => {
  const html = (await (await fixtureHttp()).text('https://legislacja.rcl.gov.pl/lista?title=Edukacji'));
  const rows = parseRclList(html, 'https://legislacja.rcl.gov.pl/lista');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].applicant, 'Minister Edukacji');
  assert.equal(rows[0].created, '2026-10-01');
  const cfg = await loadCfg();
  const items = await createRclSource(cfg.sources.find((s) => s.id === 'rcl')).listNew(await ctx());
  assert.equal(items.length, 1, 'ten sam projekt z wielu zapytań liczy się raz, a stary jest odrzucony');
  assert.equal(items[0].kind, 'draft');
});

test('RCL: zmiana układu strony (zero wierszy) kończy się błędem źródła', async () => {
  const http = { text: async () => '<html><body><div>nowy układ</div></body></html>' };
  await assert.rejects(createRclSource({ id: 'rcl', name: 'RCL', queries: ['x'] }).listNew({ http, today: '2026-10-02', lookbackDays: 7 }), /układu/);
});

test('Linki: parser pomija nawigację, filtry include/exclude działają', async () => {
  const html = (await (await fixtureHttp()).text('https://bip.test/uchwaly'));
  assert.equal(parseLinks(html, 'https://bip.test/uchwaly').length, 4);
  const src = createLinksSource({ id: 'bip', name: 'BIP', url: 'https://bip.test/uchwaly', include: 'uchwa|statut', minTitleLength: 15 });
  const items = await src.listNew(await ctx());
  assert.equal(items.length, 1);
  assert.equal(items[0].url, 'https://bip.test/uchwala/1');
});

test('RSS BIP: temat zarządzenia pobierany ze strony, gdy kanał go nie podaje', async () => {
  const cfg = await loadCfg();
  const src = createRssSource(cfg.sources.find((s) => s.id === 'bip-um-ostroleka'));
  const c = await ctx();
  const items = await src.listNew(c);
  assert.equal(items.length, 3, 'stare zarządzenie poza oknem czasu jest pominięte');
  const z = await src.enrich(items.find((i) => i.title.includes('301/2026')), c);
  assert.match(z.summary, /szkół i placówek oświatowych/);
  const p = await src.enrich(items.find((i) => i.title.includes('Projekt uchwały')), c);
  assert.match(p.summary, /Szkolno-Wychowawczego/, 'pozycja z opisem nie wymaga pobierania strony');
  const broken = await src.enrich({ ...items[0], summary: '', url: 'https://bip.um.ostroleka.pl/brak' }, c);
  assert.equal(broken.summary, '', 'niedostępna strona nie przerywa przetwarzania');
});

test('extractSubject: wyciąga temat po "w sprawie", a bez niego zwraca pusty tekst', () => {
  assert.equal(extractSubject('wydane przez Prezydenta\nw sprawie: zmiany uchwały budżetowej na 2026 rok\nStatus'), 'zmiany uchwały budżetowej na 2026 rok');
  assert.equal(extractSubject('brak tematu'), '');
});

test('buildSources: włączone źródło bez adresu to czytelny błąd, wyłączone jest pomijane', async () => {
  const cfg = await loadCfg();
  assert.ok(!buildSources(cfg).some((s) => s.id === 'bip-organ-prowadzacy'));
  const bad = { ...cfg, sources: [{ id: 'x', type: 'links', name: 'X', url: '', enabled: true }] };
  assert.throws(() => buildSources(bad), /nie ma adresu/);
});

async function runWith(cfgPatch) {
  const dir = await mkdtemp(path.join(tmpdir(), 'sosw-'));
  const sent = [];
  const cfg = { ...(await loadCfg()), ...cfgPatch };
  const store = createFileStore(path.join(dir, 's.json'));
  const base = { cfg, http: await fixtureHttp(), store, analyzer: createMockAnalyzer(), mailer: { send: async (r) => { sent.push(r); } } };
  return { base, sent, run: (now) => runScan({ ...base, now }) };
}

test('potok z nowymi źródłami: druk sejmowy, projekt RCL, akt lokalny i komunikat kuratorium trafiają do raportu', async () => {
  const { run } = await runWith({});
  const r = await run(NOW);
  const keys = r.changes.map((c) => c.key);
  assert.ok(keys.includes('sejm:t10:druk:1234'), 'druk sejmowy o Prawie oświatowym');
  assert.ok(!keys.includes('sejm:t10:druk:1235'), 'druk o drogach odfiltrowany');
  assert.ok(keys.some((k) => k.startsWith('rcl:/projekt/12390001')), 'projekt rozporządzenia MEN z RCL');
  assert.ok(keys.includes('POL_WOJ_MZ/2026/9001'), 'uchwała Rady Miasta Ostrołęki o statucie SOSW');
  assert.ok(!keys.includes('POL_WOJ_MZ/2026/9002'), 'uchwała innej gminy poza zakresem');
  assert.ok(keys.some((k) => k.startsWith('rss:kuratorium-komunikaty')), 'komunikat kuratorium');
  assert.ok(keys.some((k) => k.includes('bip-um-ostroleka') && k.includes('19500')), 'zarządzenie z BIP, wykryte po temacie ze strony');
  assert.ok(keys.some((k) => k.includes('bip-um-ostroleka') && k.includes('19502')), 'projekt uchwały o statucie SOSW z BIP');
  assert.ok(!keys.some((k) => k.includes('19501')), 'zarządzenie o służebności przesyłu odfiltrowane');
  const bill = r.changes.find((c) => c.key === 'sejm:t10:druk:1234');
  assert.equal(bill.status, 'projekt');
  assert.equal(bill.priority, 'lo', 'projekt ustawy ma niski priorytet do czasu uchwalenia');
});

test('baseline: pierwszy skan źródła bez dat tylko zapamiętuje linki, a kolejny zgłasza wyłącznie nowe', async () => {
  const cfg = await loadCfg();
  const sources = [...cfg.sources.filter((s) => !['eli-du', 'eli-mp'].includes(s.id)), { id: 'bip-test', type: 'links', name: 'BIP test', url: 'https://bip.test/uchwaly', include: 'uchwa|statut', enabled: true }]
    .filter((s) => s.id === 'bip-test');
  const { base, sent } = await runWith({ sources });
  const first = await runScan({ ...base, now: NOW });
  assert.equal(first.changes.length, 0);
  assert.equal(first.health[0].baselined, 1);
  assert.match(sent[0].text, /Zainicjowane źródła/);

  // na stronie pojawia się nowa uchwała
  const http = base.http;
  const orig = http.text;
  http.text = async (u) => (u === 'https://bip.test/uchwaly'
    ? '<ul><li><a href="/uchwala/1">Uchwała nr XL/200/2026 w sprawie zmiany statutu Specjalnego Ośrodka Szkolno-Wychowawczego</a></li><li><a href="/uchwala/3">Uchwała nr XLII/300/2026 w sprawie sieci szkół specjalnych i placówek</a></li></ul>'
    : orig(u));
  http.buffer = http.buffer;
  const second = await runScan({ ...base, now: new Date('2026-10-03T15:40:00Z') });
  assert.equal(second.changes.length, 1);
  assert.match(second.changes[0].title, /sieci szkół specjalnych/);
});
