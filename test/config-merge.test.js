import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeConfig, validateConfig } from '../src/config.js';
import { loadCfg } from './helpers.js';

const base = await loadCfg();

test('konfiguracja: brak ustawień z panelu zwraca domyślne', () => {
  assert.equal(mergeConfig(base, null), base);
});
test('konfiguracja: role, dokumenty i słowa kluczowe z panelu zastępują domyślne', () => {
  const m = mergeConfig(base, { roles: [{ name: 'Dyrektor', scope: 'x' }], keywords: { education: ['a'], supporting: [], administrative: [] } });
  assert.equal(m.roles.length, 1);
  assert.deepEqual(m.keywords.education, ['a']);
  assert.equal(m.documents.length, base.documents.length);
});
test('konfiguracja: źródła łączone po id, nowe źródła z kodu pojawiają się same, usunięte nie wracają', () => {
  const mine = base.sources.filter((s) => s.id !== 'rcl' && s.id !== 'eli-mp').map((s) => (s.id === 'eli-du' ? { ...s, enabled: false } : s));
  const m = mergeConfig(base, { sources: mine, removedSources: ['rcl'] });
  assert.equal(m.sources.find((s) => s.id === 'eli-du').enabled, false, 'zmiana z panelu ma pierwszeństwo');
  assert.ok(m.sources.some((s) => s.id === 'eli-mp'), 'źródło nieobecne w ustawieniach wraca z domyślnych');
  assert.ok(!m.sources.some((s) => s.id === 'rcl'), 'usunięte w panelu nie wraca');
});
test('konfiguracja: reguły łączone po id, a zmiana priorytetu i progu z panelu działa', () => {
  const m = mergeConfig(base, { rules: [{ id: 'r2', label: 'x', prio: 'mid', on: true, num: 14 }] });
  assert.equal(m.rules.find((r) => r.id === 'r2').num, 14);
  assert.equal(m.rules.find((r) => r.id === 'r1').prio, 'hi');
});
test('konfiguracja: niepoprawne ustawienia są wykrywane', () => {
  assert.ok(validateConfig({ roles: 'zle' }).length);
  assert.ok(validateConfig({ rules: [{ id: 'r1', prio: 'wysoki' }] }).length);
  assert.ok(validateConfig({ sources: [{ id: 'x' }] }).length);
  assert.deepEqual(validateConfig({ roles: [{ name: 'A' }] }), []);
});
