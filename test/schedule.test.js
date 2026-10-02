import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldRun } from '../src/schedule.js';
import { localParts } from '../src/util.js';

const run = (iso, extra = {}) => shouldRun({ local: localParts(new Date(iso), 'Europe/Warsaw'), alreadyRan: false, ...extra });

test('lato (UTC+2): pierwszy zapis crona 15:40Z = 17:40 lokalnie -> uruchamia', () => {
  assert.equal(run('2026-07-10T15:40:00Z').run, true);
});
test('lato: drugi zapis crona 16:40Z = 18:40 lokalnie -> uruchamia tylko jeśli nie było jeszcze skanu', () => {
  assert.equal(run('2026-07-10T16:40:00Z').run, true);
  assert.equal(run('2026-07-10T16:40:00Z', { alreadyRan: true }).run, false);
});
test('zima (UTC+1): 15:40Z = 16:40 lokalnie -> za wcześnie, a 16:40Z = 17:40 -> uruchamia', () => {
  assert.equal(run('2026-11-10T15:40:00Z').run, false);
  assert.equal(run('2026-11-10T16:40:00Z').run, true);
});
test('poza oknem (rano) nie uruchamia, --force omija straż', () => {
  assert.equal(run('2026-07-10T06:00:00Z').run, false);
  assert.equal(run('2026-07-10T06:00:00Z', { force: true }).run, true);
});
test('zmiana czasu: dzień po przejściu na zimowy (25.10.2026) liczy poprawnie', () => {
  assert.equal(localParts(new Date('2026-10-25T16:30:00Z'), 'Europe/Warsaw').hour, 17);
  assert.equal(localParts(new Date('2026-10-24T15:30:00Z'), 'Europe/Warsaw').hour, 17);
});
