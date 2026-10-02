/**
 * Wstępna ocena trafności (bez AI): punkty za organ wydający, słowa kluczowe i akty obserwowane.
 * Celem jest odrzucenie oczywistych nietrafień, zanim cokolwiek trafi do (płatnej) analizy AI.
 */
const norm = (s) => String(s ?? '').toLowerCase();

const hits = (text, list) => (list ?? []).filter((k) => text.includes(norm(k)));

export function scoreCandidate(c, cfg) {
  const text = norm([c.title, (c.keywords ?? []).join(' '), c.summary].filter(Boolean).join(' '));
  const reasons = [];
  let edu = 0; // sygnały mocne: organ, akt obserwowany, słowa kluczowe
  let weakScore = 0;
  let adm = 0;

  if (/edukacj|oświat/i.test(c.issuer ?? '')) { edu += 5; reasons.push(`organ wydający: ${c.issuer}`); }

  const watched = (cfg.watchedActs ?? []).filter((w) => (c.changedActs ?? []).includes(w.eli));
  if (watched.length) { edu += 6; reasons.push(`zmienia: ${watched.map((w) => w.name).join(', ')}`); }

  const strong = hits(text, cfg.keywords?.education);
  if (strong.length) { edu += Math.min(strong.length, 3) * 2; reasons.push(`słowa kluczowe: ${strong.slice(0, 5).join(', ')}`); }

  const weak = hits(text, cfg.keywords?.supporting);
  if (weak.length) { weakScore += Math.min(weak.length, 2); reasons.push(`słowa pomocnicze: ${weak.slice(0, 4).join(', ')}`); }

  const admin = hits(text, cfg.keywords?.administrative);
  if (admin.length) { adm += Math.min(admin.length, 2) * 2; reasons.push(`prawo administracyjne: ${admin.slice(0, 3).join(', ')}`); }

  // Słowa pomocnicze same nie decydują o kategorii: akt czysto administracyjny pozostaje administracyjnym.
  const category = edu > 0 ? 'oswiatowe' : adm > 0 ? 'administracyjne' : weakScore > 0 ? 'oswiatowe' : null;
  return { score: edu + weakScore + adm, category, reasons };
}
