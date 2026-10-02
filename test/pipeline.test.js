import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runScan } from '../src/pipeline.js';
import { createFileStore } from '../src/store/file.js';
import { createMockAnalyzer, normalizeAnalysis } from '../src/analyze.js';
import { renderReport, pluralZmiana } from '../src/report.js';
import { fixtureHttp, NOW, loadCfg } from './helpers.js';

async function setup() {
  const dir = await mkdtemp(path.join(tmpdir(), 'sosw-'));
  const sent = [];
  return {
    cfg: await loadCfg(), http: await fixtureHttp(), store: createFileStore(path.join(dir, 's.json')),
    analyzer: createMockAnalyzer(), mailer: { send: async (r) => { sent.push(r); } }, sent,
  };
}

test('potok: wykrywa zmiany, nadaje priorytety, wysyła jeden raport', async () => {
  const s = await setup();
  const r = await runScan({ ...s, now: NOW });
  assert.equal(r.skipped, false);
  const byKey = Object.fromEntries(r.changes.map((c) => [c.key, c]));
  assert.ok(byKey['DU/2026/1900'], 'rozporządzenie MEN');
  assert.equal(byKey['DU/2026/1900'].priority, 'hi');
  assert.ok(byKey['DU/2026/1905'], 'ustawa zmieniająca Prawo oświatowe');
  assert.ok(byKey['DU/2026/1950'], 'dostępność cyfrowa');
  assert.equal(byKey['DU/2026/1950'].category, 'administracyjne');
  assert.ok(!byKey['DU/2026/1901'], 'znaki drogowe odfiltrowane');
  assert.ok(Object.keys(byKey).some((k) => k.startsWith('rss:men-komunikaty')), 'projekt z MEN');
  assert.equal(s.sent.length, 1);
  assert.match(s.sent[0].subject, /Monitor prawa/);
});

test('potok: awaria jednego źródła nie zatrzymuje reszty i trafia do raportu', async () => {
  const s = await setup();
  const r = await runScan({ ...s, now: NOW });
  const bad = r.health.find((h) => h.id === 'men-wiadomosci');
  assert.equal(bad.ok, false);
  assert.ok(r.health.find((h) => h.id === 'eli-du').ok);
  assert.match(s.sent[0].text, /źródła z błędem/);
});

test('potok: drugi przebieg tego samego dnia jest pomijany (idempotencja)', async () => {
  const s = await setup();
  await runScan({ ...s, now: NOW });
  const again = await runScan({ ...s, now: new Date('2026-10-02T16:40:00Z') });
  assert.equal(again.skipped, true);
  assert.equal(s.sent.length, 1);
});

test('potok: następnego dnia te same akty nie są zgłaszane ponownie, ale terminy wracają jako przypomnienie', async () => {
  const s = await setup();
  await runScan({ ...s, now: NOW });
  const next = await runScan({ ...s, now: new Date('2026-10-03T15:40:00Z') });
  assert.equal(next.changes.length, 0);
  assert.match(next.report.subject, /bez zmian/);
  assert.match(next.report.text, /Zbliżające się terminy/);
});

test('potok: błąd wysyłki nie oznacza dnia jako wykonanego, a ponowienie nie gubi zmian', async () => {
  const s = await setup();
  let fail = true;
  s.mailer = { send: async (r) => { if (fail) throw new Error('Resend 500'); s.sent.push(r); } };
  await assert.rejects(runScan({ ...s, now: NOW }), /Resend 500/);
  fail = false;
  const retry = await runScan({ ...s, now: new Date('2026-10-02T16:40:00Z') });
  assert.equal(retry.skipped, false);
  assert.ok(retry.changes.length >= 3);
});

test('analiza: odpowiedź modelu jest czyszczona (role i dokumenty spoza listy, zła data)', async () => {
  const cfg = await loadCfg();
  const a = normalizeAnalysis({
    relevant: true, summary: 's', what_changes: 'w', affects_school: 'yes', status: 'obowiazuje',
    effective_date: 'jutro', requires_statute_change: true, requires_council_resolution: true,
    documents_to_update: ['Statut SOSW', 'Wymyślony dokument'],
    roles: [{ role: 'Dyrektor', action: 'Zrób X', deadline: '2026-12-01' }, { role: 'Hobbit', action: 'Y' }],
    legal_basis: 'b', confidence: 'wysoka',
  }, cfg);
  assert.deepEqual(a.documents, ['Statut SOSW']);
  assert.equal(a.roles.length, 1);
  assert.equal(a.effective_date, null);
  assert.equal(a.confidence, 'low');
  assert.match(a.review_note, /spoza listy/);
});

test('raport: treści z internetu są escapowane w HTML', async () => {
  const cfg = await loadCfg();
  const { html } = renderReport({
    cfg, today: '2026-10-02',
    changes: [{ key: 'k', title: '<script>alert(1)</script>', source_name: 'S', priority: 'hi', status: 'obowiazuje', summary: '<img src=x onerror=1>', tasks: [], documents: [], priority_reasons: [] }],
  });
  assert.ok(!html.includes('<script>alert'));
  assert.ok(!html.includes('<img src=x'));
});

test('odmiana: 1 zmiana, 2 zmiany, 5 zmian, 12 zmian, 22 zmiany', () => {
  assert.deepEqual([1, 2, 5, 12, 22, 25].map(pluralZmiana), ['zmiana', 'zmiany', 'zmian', 'zmian', 'zmiany', 'zmian']);
});
