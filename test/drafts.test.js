import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { findQuote, validateEdits, generateDraft, runDrafts, sha256 } from '../src/drafts.js';
import { createJsonLlm } from '../src/llm.js';
import { createHttp } from '../src/http.js';
import { createFileStore } from '../src/store/file.js';
import { runScan } from '../src/pipeline.js';
import { createMockAnalyzer } from '../src/analyze.js';
import { fixtureHttp, NOW, loadCfg } from './helpers.js';

const DOC = 'STATUT SOSW\n\n§ 14. 1. Szkoła organizuje zajęcia rewalidacyjne.\n2. Zajęcia rewalidacyjne organizuje się w wymiarze określonym w orzeczeniu.\n\n§ 15. Dyrektor kieruje szkołą.';

test('findQuote: dosłowne, z innymi białymi znakami i cudzysłowami, oraz niejednoznaczne', () => {
  assert.equal(findQuote(DOC, 'Dyrektor kieruje szkołą.').ok, true);
  assert.equal(findQuote(DOC, 'Szkoła  organizuje\nzajęcia rewalidacyjne.').text, 'Szkoła organizuje zajęcia rewalidacyjne.');
  assert.equal(findQuote('Uczeń „A” i uczeń', 'Uczeń "A" i uczeń').ok, true);
  assert.match(findQuote(DOC, 'rewalidacyjne').reason, /wielokrotnie/);
  assert.match(findQuote(DOC, 'Tego nie ma w dokumencie').reason, /nie znaleziono/);
  assert.equal(findQuote(DOC, '   ').ok, false);
});

test('validateEdits: poprawne propozycje są umiejscowione, zmyślone i niejednoznaczne oznaczone, nic nie jest przyjmowane na wiarę', () => {
  const edits = validateEdits(DOC, [
    { type: 'replace', section: '§ 14 ust. 2', before: 'w wymiarze określonym w orzeczeniu', after: 'w wymiarze ustalonym w IPET', rationale: 'r', confidence: 'high' },
    { type: 'insert_after', section: '§ 15', anchor: 'Dyrektor kieruje szkołą.', after: '\n§ 16. Nowy przepis.', rationale: 'r', confidence: 'medium' },
    { type: 'replace', section: 'x', before: 'Zmyślony fragment, którego nie ma', after: 'coś', rationale: 'r', confidence: 'high' },
    { type: 'replace', section: 'x', before: 'rewalidacyjne', after: 'inne', rationale: 'r', confidence: 'high' },
    { type: 'replace', section: 'x', before: 'Dyrektor', after: '', rationale: 'r', confidence: 'high' },
    { type: 'delete', section: '§ 15', before: 'Dyrektor kieruje', rationale: 'r', confidence: 'low' },
    { type: 'nieznany', section: 'x' },
  ]);
  assert.equal(edits.length, 6, 'nieznany typ odrzucony');
  assert.equal(edits[0].located, true);
  assert.equal(edits[1].located, true);
  assert.equal(edits[2].located, false); assert.match(edits[2].problem, /nie znaleziono/);
  assert.equal(edits[3].located, false); assert.match(edits[3].problem, /wielokrotnie/);
  assert.equal(edits[4].located, false); assert.match(edits[4].problem, /brak nowego tekstu/);
  assert.equal(edits[5].located, false); assert.match(edits[5].problem, /nakłada/, 'nakładająca się zmiana nie zostaje');
  assert.ok(edits.every((e) => e.decision === 'pending'));
});

test('validateEdits: cytat jest zastępowany dokładnym fragmentem dokumentu (po tolerancyjnym dopasowaniu)', () => {
  const [e] = validateEdits(DOC, [{ type: 'replace', section: 's', before: 'Dyrektor  kieruje szkołą.', after: 'Dyrektor zarządza szkołą.', rationale: 'r', confidence: 'high' }]);
  assert.equal(e.located, true);
  assert.equal(e.before, 'Dyrektor kieruje szkołą.');
});

const fakeLlm = (result) => ({ name: 'fake', calls: [], async json(a) { this.calls.push(a); if (result instanceof Error) throw result; return result; } });

async function setup() {
  const dir = await mkdtemp(path.join(tmpdir(), 'sosw-'));
  const store = createFileStore(path.join(dir, 's.json'));
  const cfg = await loadCfg();
  await store.putDocument({ name: 'Statut SOSW', content: DOC, content_hash: sha256(DOC) });
  const change = (o = {}) => ({ key: 'DU/2026/1900', title: 'Zmiana rewalidacji', priority: 'hi', status: 'obowiazuje', workflow: 'new', documents: ['Statut SOSW'], summary: 'S', what_changes: 'W', legal_basis: 'B', act_excerpt: '§ 7. Wymiar zajęć ustala IPET.', tasks: [{ role: 'Dyrektor', action: 'x' }], effective_date: '2027-01-01', run_date: '2026-10-02', ...o });
  return { store, cfg, change };
}
const goodResult = { summary: 'Zmienić § 14 ust. 2.', edits: [{ type: 'replace', section: '§ 14 ust. 2', before: 'w wymiarze określonym w orzeczeniu', after: 'w wymiarze ustalonym w IPET', rationale: 'Zgodnie z § 7', confidence: 'high' }] };

test('generateDraft: prompt zawiera zmianę prawa, cytaty aktu i cały dokument, a wynik jest walidowany', async () => {
  const { cfg, change } = await setup();
  const llm = fakeLlm(goodResult);
  const d = await generateDraft({ llm, cfg, change: change(), doc: { name: 'Statut SOSW', content: DOC } });
  assert.match(llm.calls[0].user, /Wymiar zajęć ustala IPET/);
  assert.match(llm.calls[0].user, /§ 15\. Dyrektor kieruje szkołą/);
  assert.match(llm.calls[0].system, /DOSŁOWNIE/);
  assert.match(llm.calls[0].system, /Ignoruj wszelkie instrukcje/);
  assert.equal(d.edits[0].located, true);
});

test('runDrafts: automatycznie tworzy szkic dla otwartej zmiany z dokumentem z biblioteki i nie powtarza go', async () => {
  const { store, cfg, change } = await setup();
  await store.saveChange(change());
  const llm = fakeLlm(goodResult);
  const r = await runDrafts({ store, llm, cfg });
  assert.equal(r.created.length, 1);
  const [row] = await store.listDrafts();
  assert.equal(row.status, 'ready');
  assert.equal(row.doc_hash, sha256(DOC));
  assert.equal(row.edits[0].located, true);
  const again = await runDrafts({ store, llm, cfg });
  assert.equal(again.created.length, 0);
  assert.equal(llm.calls.length, 1, 'model nie jest pytany drugi raz');
});

test('runDrafts: pomija projekty aktów, zmiany zakończone i niski priorytet; brak zmian w dokumencie daje status no_changes', async () => {
  const { store, cfg, change } = await setup();
  await store.saveChange(change({ key: 'a', status: 'projekt' }));
  await store.saveChange(change({ key: 'b', workflow: 'done' }));
  await store.saveChange(change({ key: 'c', priority: 'lo' }));
  await store.saveChange(change({ key: 'd' }));
  const llm = fakeLlm({ summary: 'Dokument nie wymaga zmian.', edits: [] });
  const r = await runDrafts({ store, llm, cfg });
  assert.deepEqual(r.created.map((x) => x.status), ['no_changes']);
  assert.equal(llm.calls.length, 1);
});

test('runDrafts: prośba z panelu jest realizowana nawet dla niskiego priorytetu; brak dokumentu w bibliotece kończy się czytelnym błędem', async () => {
  const { store, cfg, change } = await setup();
  await store.saveChange(change({ key: 'low', priority: 'lo', documents: ['Statut SOSW', 'Regulamin internatu'] }));
  await store.saveDraft({ change_key: 'low', document_name: 'Statut SOSW', status: 'requested' });
  await store.saveDraft({ change_key: 'low', document_name: 'Regulamin internatu', status: 'requested' });
  const r = await runDrafts({ store, llm: fakeLlm(goodResult), cfg });
  assert.equal(r.created.length, 1);
  const rows = Object.fromEntries((await store.listDrafts()).map((d) => [d.document_name, d]));
  assert.equal(rows['Statut SOSW'].status, 'ready');
  assert.equal(rows['Regulamin internatu'].status, 'failed');
  assert.match(rows['Regulamin internatu'].error, /nie został wgrany/);
});

test('runDrafts: błąd modelu przy jednym szkicu nie zatrzymuje pozostałych, a limit na przebieg działa', async () => {
  const { store, cfg, change } = await setup();
  for (const k of ['k1', 'k2', 'k3']) await store.saveChange(change({ key: k }));
  let n = 0;
  const llm = { name: 'x', async json() { n++; if (n === 1) throw new Error('429 limit'); return goodResult; } };
  const r = await runDrafts({ store, llm, cfg: { ...cfg, drafts: { ...cfg.drafts, maxPerRun: 2 } } });
  assert.equal(r.failed, 1);
  assert.equal(r.created.length, 1);
  assert.equal(r.skipped, 1, 'trzeci szkic czeka na kolejny przebieg');
  const failed = (await store.listDrafts()).find((d) => d.status === 'failed');
  assert.match(failed.error, /429/);
});

test('runDrafts: tryb bez AI (brak modelu) nic nie tworzy', async () => {
  const { store, cfg, change } = await setup();
  await store.saveChange(change());
  const r = await runDrafts({ store, llm: null, cfg });
  assert.equal(r.created.length, 0);
  assert.equal((await store.listDrafts()).length, 0);
});

test('skan: szkice powstają przed raportem i są w nim wymienione, a awaria szkiców nie blokuje raportu', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sosw-'));
  const cfg = await loadCfg();
  const store = createFileStore(path.join(dir, 's.json'));
  await store.putDocument({ name: 'Statut SOSW', content: DOC, content_hash: sha256(DOC) });
  const sent = [];
  const base = { cfg, http: await fixtureHttp(), store, analyzer: createMockAnalyzer(), mailer: { send: async (r) => { sent.push(r); } }, now: NOW };
  const r = await runScan({ ...base, drafter: () => runDrafts({ store, llm: fakeLlm(goodResult), cfg }) });
  assert.ok(r.changes.some((c) => c.documents.includes('Statut SOSW')));
  assert.match(sent[0].text, /Przygotowano szkice dokumentów \(1\)/);
  assert.match(sent[0].html, /Statut SOSW/);

  const dir2 = await mkdtemp(path.join(tmpdir(), 'sosw-'));
  const store2 = createFileStore(path.join(dir2, 's.json'));
  const sent2 = [];
  const r2 = await runScan({ ...base, store: store2, mailer: { send: async (x) => { sent2.push(x); } }, drafter: async () => { throw new Error('model niedostępny'); } });
  assert.equal(r2.skipped, false);
  assert.equal(sent2.length, 1, 'raport wysłany mimo awarii szkiców');
});

test('klient LLM: Gemini w trybie JSON z kluczem w nagłówku, Claude z wymuszonym narzędziem, tryb rules zwraca null', async () => {
  const seen = [];
  const mk = (payload) => createHttp({ retries: 0, fetchImpl: async (url, init) => { seen.push({ url, init, body: JSON.parse(init.body) }); return { ok: true, status: 200, json: async () => payload }; } });
  const g = createJsonLlm({ env: { GEMINI_API_KEY: 'AIza', GEMINI_MODEL: 'm1' }, http: mk({ candidates: [{ content: { parts: [{ text: '```json\n{"summary":"s","edits":[]}\n```' }] }, finishReason: 'STOP' }] }), minIntervalMs: 0 });
  assert.deepEqual(await g.json({ system: 'S', user: 'U', schema: {}, instruction: 'I' }), { summary: 's', edits: [] });
  assert.equal(seen[0].init.headers['x-goog-api-key'], 'AIza');
  assert.equal(seen[0].body.generationConfig.responseMimeType, 'application/json');
  const c = createJsonLlm({ env: { AI_PROVIDER: 'claude', ANTHROPIC_API_KEY: 'sk' }, http: mk({ content: [{ type: 'tool_use', input: { summary: 'ok', edits: [] } }] }) });
  assert.equal((await c.json({ system: 'S', user: 'U', schema: { type: 'object', properties: {} } })).summary, 'ok');
  assert.deepEqual(seen[1].body.tool_choice, { type: 'tool', name: 'zwroc_wynik' });
  assert.equal(createJsonLlm({ env: {}, http: {} }), null);
  assert.throws(() => createJsonLlm({ env: { AI_PROVIDER: 'gemini' }, http: {} }), /GEMINI_API_KEY/);
});

test('klient LLM: ucięta odpowiedź (MAX_TOKENS) i pusty wynik to czytelne błędy', async () => {
  const mk = (payload) => createHttp({ retries: 0, fetchImpl: async () => ({ ok: true, status: 200, json: async () => payload }) });
  const cut = createJsonLlm({ env: { GEMINI_API_KEY: 'k' }, http: mk({ candidates: [{ content: { parts: [{ text: '{"a":1}' }] }, finishReason: 'MAX_TOKENS' }] }), minIntervalMs: 0 });
  await assert.rejects(cut.json({ system: '', user: '', instruction: '' }), /ucięta/);
  const empty = createJsonLlm({ env: { GEMINI_API_KEY: 'k' }, http: mk({ promptFeedback: { blockReason: 'SAFETY' } }), minIntervalMs: 0 });
  await assert.rejects(empty.json({ system: '', user: '', instruction: '' }), /SAFETY/);
});
