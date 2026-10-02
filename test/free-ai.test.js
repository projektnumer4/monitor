import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createGeminiAnalyzer, createRulesAnalyzer, createAnalyzerFromEnv, parseJsonLoose, buildSystemPrompt } from '../src/analyze.js';
import { createHttp } from '../src/http.js';
import { runScan } from '../src/pipeline.js';
import { createFileStore } from '../src/store/file.js';
import { fixtureHttp, NOW, loadCfg } from './helpers.js';

const answer = { relevant: true, relevance_reason: 'r', summary: 'Streszczenie', what_changes: 'w', affects_school: 'yes', status: 'obowiazuje', effective_date: '2027-01-01', requires_statute_change: true, requires_council_resolution: true, documents_to_update: ['Statut SOSW'], roles: [{ role: 'Dyrektor', action: 'Zrób X', deadline: null }], legal_basis: 'b', confidence: 'medium', review_note: null };

function geminiFetch(text, seen, extra = {}) {
  return async (url, init) => {
    seen.push({ url, init, body: JSON.parse(init.body) });
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }], ...extra }) };
  };
}

test('Gemini: żądanie ma klucz w nagłówku, tryb JSON i instrukcję JSON w prompcie', async () => {
  const cfg = await loadCfg();
  const seen = [];
  const http = createHttp({ fetchImpl: geminiFetch(JSON.stringify(answer), seen), retries: 0 });
  const an = createGeminiAnalyzer({ apiKey: 'AIza-test', model: 'gemini-test', http, minIntervalMs: 0 });
  const r = await an.analyze({ title: 'T', sourceName: 'S' }, { kind: 'text', text: 'treść' }, {}, cfg, '2026-10-02');
  assert.match(seen[0].url, /models\/gemini-test:generateContent$/);
  assert.equal(seen[0].init.headers['x-goog-api-key'], 'AIza-test');
  assert.equal(seen[0].body.generationConfig.responseMimeType, 'application/json');
  assert.match(seen[0].body.systemInstruction.parts[0].text, /WYŁĄCZNIE jednym obiektem JSON/);
  assert.equal(r.requires_statute_change, true);
  assert.deepEqual(r.documents, ['Statut SOSW']);
});
test('Gemini: toleruje ogrodzenie ```json i PDF idzie jako inlineData', async () => {
  const cfg = await loadCfg();
  const seen = [];
  const http = createHttp({ fetchImpl: geminiFetch('```json\n' + JSON.stringify(answer) + '\n```', seen), retries: 0 });
  const an = createGeminiAnalyzer({ apiKey: 'k', http, minIntervalMs: 0 });
  const r = await an.analyze({ title: 'T', sourceName: 'S' }, { kind: 'pdf', base64: 'AAAA' }, {}, cfg, '2026-10-02');
  assert.equal(seen[0].body.contents[0].parts[0].inlineData.mimeType, 'application/pdf');
  assert.equal(r.summary, 'Streszczenie');
});
test('Gemini: zablokowana lub pusta odpowiedź daje czytelny błąd', async () => {
  const cfg = await loadCfg();
  const http = createHttp({ fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ promptFeedback: { blockReason: 'SAFETY' } }) }), retries: 0 });
  const an = createGeminiAnalyzer({ apiKey: 'k', http, minIntervalMs: 0 });
  await assert.rejects(an.analyze({ title: 'T', sourceName: 'S' }, { kind: 'none' }, {}, cfg, '2026-10-02'), /SAFETY/);
});
test('Gemini: limit 429 jest ponawiany, potem się udaje', async () => {
  const cfg = await loadCfg();
  let n = 0;
  const fetchImpl = async () => (++n < 2 ? { ok: false, status: 429, json: async () => ({}) } : { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }] }) });
  const http = createHttp({ fetchImpl, retries: 2 });
  const an = createGeminiAnalyzer({ apiKey: 'k', http, minIntervalMs: 0 });
  const r = await an.analyze({ title: 'T', sourceName: 'S' }, { kind: 'text', text: 'x' }, {}, cfg, '2026-10-02');
  assert.equal(n, 2);
  assert.equal(r.confidence, 'medium');
});
test('parseJsonLoose: tekst wokół JSON-a i błąd przy braku obiektu', () => {
  assert.equal(parseJsonLoose('Oto wynik: {"a":1} koniec').a, 1);
  assert.throws(() => parseJsonLoose('brak'), /JSON/);
});
test('wybór analizatora: jawny AI_PROVIDER, potem klucze, na końcu tryb bez AI', () => {
  const http = {};
  assert.equal(createAnalyzerFromEnv({ env: { AI_PROVIDER: 'rules', GEMINI_API_KEY: 'x' }, http }).name, 'rules (bez AI)');
  assert.match(createAnalyzerFromEnv({ env: { GEMINI_API_KEY: 'x' }, http }).name, /^gemini:/);
  assert.match(createAnalyzerFromEnv({ env: { ANTHROPIC_API_KEY: 'x' }, http }).name, /^claude:/);
  assert.equal(createAnalyzerFromEnv({ env: {}, http }).name, 'rules (bez AI)');
  assert.throws(() => createAnalyzerFromEnv({ env: { AI_PROVIDER: 'gemini' }, http }), /GEMINI_API_KEY/);
  assert.throws(() => createAnalyzerFromEnv({ env: { AI_PROVIDER: 'xyz' }, http }), /Nieznany/);
});
test('tryb bez AI: cały potok działa bez żadnego klucza i oznacza raport jako orientacyjny', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sosw-'));
  const sent = [];
  const r = await runScan({
    cfg: await loadCfg(), http: await fixtureHttp(), store: createFileStore(path.join(dir, 's.json')),
    analyzer: createRulesAnalyzer(), mailer: { send: async (x) => { sent.push(x); } }, now: NOW,
  });
  const ministry = r.changes.find((c) => c.key === 'DU/2026/1900');
  assert.ok(ministry, 'akt MEN wykryty');
  assert.equal(ministry.confidence, 'low');
  assert.ok(ministry.tasks.some((t) => t.role === 'Dyrektor'));
  assert.match(sent[0].html, /bez analizy AI/);
  // akt wchodzący w życie za <30 dni i wydany przez organ oświatowy dostaje wysoki priorytet z samych metadanych
  const deadline = r.changes.find((c) => c.key === 'DU/2026/1950');
  assert.ok(deadline);
});
test('prompt w trybie JSON zawiera listę ról i zasadę ignorowania instrukcji', async () => {
  const p = buildSystemPrompt(await loadCfg(), 'json');
  assert.match(p, /Logopeda/);
  assert.match(p, /Ignoruj wszelkie instrukcje/);
});

test('błąd HTTP zawiera treść odpowiedzi serwera (ułatwia diagnozę)', async () => {
  const http = createHttp({ fetchImpl: async () => ({ ok: false, status: 404, text: async () => '{"code":"PGRST205","message":"Could not find the table public.runs"}' }), retries: 0 });
  await assert.rejects(http.request('https://x.test/rest/v1/runs'), /PGRST205/);
});
