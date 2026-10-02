// Logika szkiców po stronie panelu: odnajdywanie zmian w dokumencie i składanie wyniku.
// Miejsce zmiany zawsze ustalamy na podstawie cytatu z AKTUALNEGO tekstu dokumentu, a nie zapamiętanych pozycji,
// dzięki czemu edycja dokumentu po wygenerowaniu szkicu niczego po cichu nie psuje.

export function locateEdit(doc, e) {
  const q = e.type === 'insert_after' ? e.anchor : e.before;
  if (!q) return null;
  const first = doc.indexOf(q);
  if (first < 0 || doc.indexOf(q, first + 1) >= 0) return null;
  const end = first + q.length;
  return e.type === 'insert_after' ? { start: end, end } : { start: first, end };
}

/** Zmiany do zastosowania (domyślnie zaakceptowane), bez nakładających się, posortowane po położeniu. */
export function resolveEdits(doc, edits, decision = 'accepted') {
  const ranges = [];
  for (const [order, e] of edits.entries()) {
    if (e.decision !== decision || !e.located) continue;
    const r = locateEdit(doc, e);
    if (!r) continue;
    const clash = ranges.some((x) => (r.start < x.end && r.end > x.start) || (r.start === r.end && r.start > x.start && r.start < x.end) || (x.start === x.end && x.start > r.start && x.start < r.end));
    if (!clash) ranges.push({ ...r, edit: e, order });
  }
  return ranges.sort((a, b) => a.start - b.start || a.order - b.order);
}

/** Cały dokument jako lista odcinków: bez zmian, usunięte i dodane. */
export function buildSegments(doc, edits) {
  const segs = [];
  let pos = 0;
  const push = (t, s) => { if (s) segs.push({ t, s }); };
  for (const r of resolveEdits(doc, edits)) {
    push('same', doc.slice(pos, r.start));
    if (r.edit.type === 'replace') { push('del', doc.slice(r.start, r.end)); push('ins', r.edit.after); }
    else if (r.edit.type === 'delete') push('del', doc.slice(r.start, r.end));
    else push('ins', r.edit.after);
    pos = r.end;
  }
  push('same', doc.slice(pos));
  return segs;
}

export const textAfter = (doc, edits) => buildSegments(doc, edits).filter((s) => s.t !== 'del').map((s) => s.s).join('');

/** Fragment otoczenia zmiany do podglądu. */
export function contextFor(doc, e, n = 160) {
  const r = locateEdit(doc, e);
  if (!r) return null;
  const cut = (s, fromEnd) => (s.length > n ? (fromEnd ? `…${s.slice(-n)}` : `${s.slice(0, n)}…`) : s);
  return { pre: cut(doc.slice(Math.max(0, r.start - n - 1), r.start), true), post: cut(doc.slice(r.end, r.end + n + 1), false) };
}

export function changeList(edits, decision = 'accepted') {
  return edits.filter((e) => e.decision === decision).map((e, i) => {
    const head = `${i + 1}. ${e.section || 'Zmiana'}`;
    if (e.type === 'replace') return `${head}\n   ZAMIEŃ: „${e.before}”\n   NA: „${e.after}”\n   Uzasadnienie: ${e.rationale}`;
    if (e.type === 'delete') return `${head}\n   USUŃ: „${e.before}”\n   Uzasadnienie: ${e.rationale}`;
    return `${head}\n   PO FRAGMENCIE: „${e.anchor}”\n   DOPISZ: „${e.after.replace(/^\n/, '')}”\n   Uzasadnienie: ${e.rationale}`;
  }).join('\n\n');
}

export function summarize(draft) {
  const edits = draft.edits ?? [];
  return {
    total: edits.length,
    located: edits.filter((e) => e.located).length,
    accepted: edits.filter((e) => e.decision === 'accepted').length,
    rejected: edits.filter((e) => e.decision === 'rejected').length,
    pending: edits.filter((e) => e.located && e.decision === 'pending').length,
    unlocated: edits.filter((e) => !e.located).length,
  };
}
