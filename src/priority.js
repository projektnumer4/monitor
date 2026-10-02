import { daysBetween } from './util.js';

export const ORDER = { hi: 0, mid: 1, lo: 2 };
export const PRIORITY_LABEL = { hi: 'Wysoki', mid: 'Średni', lo: 'Niski' };

/**
 * Warunki reguł priorytetu. Identyfikatory r1–r6 odpowiadają regułom w panelu admina.
 * Wynikowy priorytet to NAJWYŻSZY z priorytetów reguł, które pasują do zmiany.
 */
const PREDICATES = {
  r1: (c) => !c.isDraft && c.requires_statute_change,
  r2: (c, rule) => !c.isDraft && c.affects_school === 'yes' && c.daysLeft !== null && c.daysLeft < (rule.num ?? 30),
  r3: (c) => !c.isDraft && c.documents.length > 0,
  r4: (c) => c.status === 'wytyczne',
  r5: (c) => c.isDraft,
  r6: (c) => c.category === 'administracyjne',
};

export function decidePriority(change, rules, today) {
  const ctx = {
    ...change,
    isDraft: change.status === 'projekt' || change.status === 'informacja',
    daysLeft: change.effective_date ? daysBetween(today, change.effective_date) : null,
  };
  const matched = [];
  for (const rule of rules) {
    if (!rule.on) continue;
    const test = PREDICATES[rule.id];
    if (test && test(ctx, rule)) matched.push(rule);
  }
  if (!matched.length) return { priority: 'lo', reasons: ['żadna reguła priorytetu nie pasuje'] };
  const best = matched.reduce((m, r) => (ORDER[r.prio] < ORDER[m] ? r.prio : m), 'lo');
  return { priority: best, reasons: matched.filter((r) => r.prio === best).map((r) => r.label) };
}
