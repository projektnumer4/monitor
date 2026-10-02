import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mergeConfig as webMerge, persistable } from '../js/cfg.js';
import { mergeConfig as engineMerge } from '../../src/config.js';
import { loadDefaults } from './helpers.js';

test('web/defaults.json jest identyczny z config/default.json (po zmianie źródeł uruchom: npm run sync-defaults)', async () => {
  const a = JSON.parse(await readFile(new URL('../defaults.json', import.meta.url), 'utf8'));
  const b = JSON.parse(await readFile(new URL('../../config/default.json', import.meta.url), 'utf8'));
  assert.deepEqual(a, b);
});

test('łączenie ustawień w panelu daje ten sam wynik co w silniku', async () => {
  const base = await loadDefaults();
  const overrides = [
    null,
    { roles: [{ name: 'A', scope: 'x' }] },
    { sources: base.sources.filter((s) => s.id !== 'rcl').map((s) => ({ ...s, enabled: s.id === 'eli-du' })), removedSources: ['rcl'] },
    { rules: [{ id: 'r2', label: 'x', prio: 'mid', on: true, num: 7 }], school: { name: 'Inna' }, keywords: { education: ['a'], supporting: [], administrative: [] } },
  ];
  for (const o of overrides) {
    const w = webMerge(base, o); const e = engineMerge(base, o);
    delete w.removedSources;
    assert.deepEqual(w, e);
  }
});

test('zapis do bazy obejmuje wyłącznie pola edytowane w panelu', async () => {
  const p = persistable(await loadDefaults());
  assert.deepEqual(Object.keys(p).sort(), ['documents', 'keywords', 'removedSources', 'roles', 'rules', 'school', 'sources']);
});
