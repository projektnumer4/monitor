import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEnvOverrides } from '../src/config.js';

test('DRAFTS_AUTO=false wyłącza szkice automatyczne, nawet gdy ustawienia z panelu je włączają', () => {
  const cfg = { drafts: { auto: true, maxPerRun: 6 } };
  assert.equal(applyEnvOverrides(cfg, { DRAFTS_AUTO: 'false' }).drafts.auto, false);
  assert.equal(applyEnvOverrides(cfg, { DRAFTS_AUTO: 'false' }).drafts.maxPerRun, 6);
});
test('DRAFTS_AUTO=true włącza, a brak lub bzdura nie zmienia nic', () => {
  assert.equal(applyEnvOverrides({ drafts: { auto: false } }, { DRAFTS_AUTO: 'true' }).drafts.auto, true);
  const cfg = { drafts: { auto: true } };
  assert.equal(applyEnvOverrides(cfg, {}), cfg);
  assert.equal(applyEnvOverrides(cfg, { DRAFTS_AUTO: 'może' }), cfg);
});
