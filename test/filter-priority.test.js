import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreCandidate } from '../src/filter.js';
import { decidePriority } from '../src/priority.js';
import { loadCfg } from './helpers.js';

const cfg = await loadCfg();

test('filtr: rozporządzenie MEN przechodzi, znaki drogowe nie', () => {
  const edu = scoreCandidate({ title: 'Rozporządzenie w sprawie organizacji kształcenia specjalnego', issuer: 'MIN. EDUKACJI' }, cfg);
  const road = scoreCandidate({ title: 'Rozporządzenie w sprawie znaków drogowych', issuer: 'MIN. INFRASTRUKTURY', keywords: ['drogi'] }, cfg);
  assert.ok(edu.score >= cfg.filter.minScore);
  assert.equal(edu.category, 'oswiatowe');
  assert.ok(road.score < cfg.filter.minScore);
});
test('filtr: ustawa zmieniająca akt obserwowany przechodzi mimo neutralnego tytułu', () => {
  const s = scoreCandidate({ title: 'Ustawa o zmianie niektórych ustaw', changedActs: ['DU/2017/59'] }, cfg);
  assert.ok(s.score >= cfg.filter.minScore);
  assert.match(s.reasons.join(' '), /Prawo oświatowe/);
});
test('filtr: sama dostępność cyfrowa to prawo administracyjne', () => {
  const s = scoreCandidate({ title: 'Rozporządzenie w sprawie dostępności cyfrowej stron', issuer: 'MIN. CYFRYZACJI' }, cfg);
  assert.equal(s.category, 'administracyjne');
});

const base = { documents: [], requires_statute_change: false, affects_school: 'yes', status: 'obowiazuje', effective_date: null, category: 'oswiatowe' };
const prio = (o) => decidePriority({ ...base, ...o }, cfg.rules, '2026-10-02');

test('priorytet: zmiana statutu = wysoki', () => assert.equal(prio({ requires_statute_change: true, effective_date: '2027-06-01' }).priority, 'hi'));
test('priorytet: termin poniżej 30 dni = wysoki, powyżej = nie', () => {
  assert.equal(prio({ effective_date: '2026-10-20' }).priority, 'hi');
  assert.equal(prio({ effective_date: '2026-12-20' }).priority, 'lo');
});
test('priorytet: procedura wewnętrzna = średni', () => assert.equal(prio({ documents: ['Procedura opracowania IPET'], effective_date: '2027-03-01' }).priority, 'mid'));
test('priorytet: projekt aktu zawsze niski, nawet ze zmianą statutu', () => {
  assert.equal(prio({ status: 'projekt', requires_statute_change: true, documents: ['Statut SOSW'] }).priority, 'lo');
});
test('priorytet: wyłączona reguła nie działa', () => {
  const rules = cfg.rules.map((r) => (r.id === 'r1' ? { ...r, on: false } : r));
  assert.equal(decidePriority({ ...base, requires_statute_change: true, effective_date: '2027-06-01' }, rules, '2026-10-02').priority, 'lo');
});
test('priorytet: zmiana poziomu reguły w konfiguracji zmienia wynik', () => {
  const rules = cfg.rules.map((r) => (r.id === 'r3' ? { ...r, prio: 'hi' } : r));
  assert.equal(decidePriority({ ...base, documents: ['X'] }, rules, '2026-10-02').priority, 'hi');
});
test('priorytet: akt już obowiązujący, wpływający na szkołę, jest wysoki (termin minął)', () => {
  assert.equal(prio({ effective_date: '2026-09-30' }).priority, 'hi');
});

test('filtr: odmiana polska (szkół, placówek, orzeczeń, dostępności) jest rozpoznawana', () => {
  for (const title of [
    'Uchwała w sprawie sieci szkół specjalnych i placówek',
    'Zarządzenie w sprawie wykazu placówek',
    'Rozporządzenie w sprawie wydawania orzeczeń',
  ]) {
    assert.ok(scoreCandidate({ title }, cfg).score >= cfg.filter.minScore, title);
  }
  assert.ok(scoreCandidate({ title: 'Komunikat o dostępności stron' }, cfg).score >= 1);
});
