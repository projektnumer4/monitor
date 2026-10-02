/**
 * Straż czasu: GitHub Actions działa w UTC, a Polska zmienia czas dwa razy w roku.
 * Workflow uruchamia się w dwóch godzinach UTC, a ta funkcja decyduje, czy właśnie teraz jest
 * odpowiednia pora (okno w czasie lokalnym) i czy dzisiejszy skan już się nie odbył.
 */
export function shouldRun({ local, alreadyRan, force = false, window = { from: 17, to: 19 } }) {
  if (force) return { run: true, reason: 'wymuszone ręcznie' };
  if (alreadyRan) return { run: false, reason: `skan z dnia ${local.date} już wykonany` };
  if (local.hour < window.from) return { run: false, reason: `za wcześnie (${local.hour}:xx, okno od ${window.from}:00)` };
  if (local.hour > window.to) return { run: false, reason: `po oknie (${local.hour}:xx, okno do ${window.to}:59)` };
  return { run: true, reason: 'w oknie czasowym' };
}
