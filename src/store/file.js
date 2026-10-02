import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

/** Magazyn w pliku JSON: do testów i uruchomień próbnych (nie do produkcji). */
export function createFileStore(file = '.data/state.json') {
  let state = null;
  const load = async () => {
    if (state) return state;
    try { state = JSON.parse(await readFile(file, 'utf8')); } catch { state = { seen: {}, changes: {}, runs: {} }; }
    return state;
  };
  const save = async () => {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(state, null, 2));
  };
  return {
    kind: 'file',
    async hasRun(date) { return (await load()).runs[date]?.status === 'ok'; },
    async recordRun(date, summary) { (await load()).runs[date] = { status: 'ok', summary }; await save(); },
    async getSeen(keys) { const s = await load(); return new Set(keys.filter((k) => s.seen[k])); },
    async hasSeenFrom(sourceId) { return Object.values((await load()).seen).some((r) => r.source_id === sourceId); },
    async markSeen(rows) { const s = await load(); rows.forEach((r) => { s.seen[r.key] = r; }); await save(); },
    async saveChange(c) { (await load()).changes[c.key] = c; await save(); },
    async listByRunDate(date) { return Object.values((await load()).changes).filter((c) => c.run_date === date); },
    async listUpcoming(from, to) {
      return Object.values((await load()).changes)
        .filter((c) => c.effective_date && c.effective_date >= from && c.effective_date <= to)
        .sort((a, b) => a.effective_date.localeCompare(b.effective_date));
    },
  };
}
