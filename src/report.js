import { esc, plDate, daysBetween } from './util.js';
import { ORDER, PRIORITY_LABEL } from './priority.js';

const COLORS = { hi: ['#C23B3B', '#FCE9E9'], mid: ['#A86A0A', '#FBF0DA'], lo: ['#2F7A66', '#E2F2EC'] };
const STATUS = { obowiazuje: 'obowiązuje', projekt: 'projekt', wytyczne: 'wytyczne', informacja: 'informacja' };

/** Polska odmiana: 1 zmiana, 2-4 zmiany, 5+ zmian (12-14 zmian). */
export const pluralZmiana = (n) => {
  const t = n % 10;
  const h = n % 100;
  return n === 1 ? 'zmiana' : t >= 2 && t <= 4 && !(h >= 12 && h <= 14) ? 'zmiany' : 'zmian';
};

const sortChanges = (list) => [...list].sort((a, b) => ORDER[a.priority] - ORDER[b.priority] || String(a.effective_date ?? '9').localeCompare(String(b.effective_date ?? '9')));

function deadlineText(c, today) {
  if (!c.effective_date) return 'brak terminu';
  const d = daysBetween(today, c.effective_date);
  const when = plDate(c.effective_date);
  if (d < 0) return `obowiązuje od ${when}`;
  if (d === 0) return `wchodzi w życie dzisiaj (${when})`;
  return `za ${d} dni (${when})`;
}

/** Buduje raport dzienny: temat, HTML (do e-maila) i wersję tekstową. */
export function renderReport({ cfg, today, changes, upcoming = [], health = [], stats = {}, appUrl = '', drafts = null, audience = null, footer = null }) {
  const list = sortChanges(changes);
  const count = (p) => list.filter((c) => c.priority === p).length;
  const link = (c) => (appUrl ? `${appUrl.replace(/\/$/, '')}/changes/${encodeURIComponent(c.key)}` : c.url);
  const failed = health.filter((h) => !h.ok);

  const subject = list.length
    ? `Monitor prawa: ${list.length} ${pluralZmiana(list.length)}${count('hi') ? `, w tym ${count('hi')} o wysokim priorytecie` : ''} (${plDate(today)})`
    : `Monitor prawa: dziś bez zmian (${plDate(today)})`;

  const card = (c) => {
    const [fg, bg] = COLORS[c.priority];
    const tasks = (c.tasks ?? []).map((t) => `<li style="margin:4px 0"><b>${esc(t.role)}:</b> ${esc(t.action)}${t.deadline ? ` <span style="color:#5C6478">(do ${esc(plDate(t.deadline))})</span>` : ''}</li>`).join('');
    return `<div style="border:1px solid #E2E5EC;border-left:4px solid ${fg};border-radius:10px;padding:14px 16px;margin:12px 0;background:#fff">
  <div style="margin-bottom:6px"><span style="background:${bg};color:${fg};font-weight:700;font-size:12px;padding:2px 9px;border-radius:999px">${PRIORITY_LABEL[c.priority]}</span>
  <span style="color:#5C6478;font-size:12px;margin-left:8px">${esc(c.source_name)} · ${esc(STATUS[c.status] ?? c.status)} · ${esc(deadlineText(c, today))}</span></div>
  <a href="${esc(link(c))}" style="color:#171B26;font-weight:700;font-size:16px;text-decoration:none">${esc(c.title)}</a>
  <p style="margin:8px 0;color:#2b3142;font-size:14px">${esc(c.summary)}</p>
  ${c.what_changes ? `<p style="margin:8px 0;font-size:14px"><b>Co się zmienia:</b> ${esc(c.what_changes)}</p>` : ''}
  ${(c.documents ?? []).length ? `<p style="margin:8px 0;font-size:14px"><b>Dokumenty do zmiany:</b> ${(c.documents).map(esc).join(', ')}${c.requires_council_resolution ? ' (wymagana uchwała rady pedagogicznej)' : ''}</p>` : ''}
  ${tasks ? `<ul style="margin:8px 0;padding-left:20px;font-size:14px">${tasks}</ul>` : ''}
  <p style="margin:8px 0 0;font-size:12px;color:#5C6478">Priorytet: ${esc((c.priority_reasons ?? []).join('; '))}${c.review_note ? `<br>⚠ Do sprawdzenia: ${esc(c.review_note)}` : ''}</p>
</div>`;
  };

  const sections = ['hi', 'mid', 'lo']
    .map((p) => {
      const items = list.filter((c) => c.priority === p);
      return items.length ? `<h2 style="font-size:15px;margin:22px 0 4px;color:${COLORS[p][0]}">${PRIORITY_LABEL[p]} priorytet (${items.length})</h2>${items.map(card).join('')}` : '';
    })
    .join('');

  const upcomingHtml = upcoming.length
    ? `<h2 style="font-size:15px;margin:26px 0 6px">Zbliżające się terminy z wcześniejszych raportów</h2><ul style="padding-left:20px;font-size:14px">${upcoming.map((c) => `<li style="margin:4px 0"><b>${esc(deadlineText(c, today))}:</b> ${esc(c.title)}</li>`).join('')}</ul>`
    : '';

  const healthHtml = failed.length
    ? `<div style="background:#FBF0DA;color:#6b4306;border-radius:10px;padding:10px 14px;margin:18px 0;font-size:13px"><b>Uwaga: nie wszystkie źródła odpowiedziały.</b><br>${failed.map((h) => `${esc(h.name)}: ${esc(h.error)}`).join('<br>')}<br>Zmiany z tych źródeł mogą być widoczne dopiero w kolejnym raporcie.</div>`
    : '';

  const baselined = health.filter((h) => h.baselined);
  const baselineHtml = baselined.length
    ? `<div style="background:#E8ECFE;color:#222B52;border-radius:10px;padding:10px 14px;margin:18px 0;font-size:13px"><b>Nowe źródła zostały zainicjowane.</b><br>${baselined.map((h) => `${esc(h.name)}: zapamiętano ${h.baselined} istniejących pozycji`).join('<br>')}<br>Zmiany będą zgłaszane od następnego skanu.</div>`
    : '';

  const draftList = drafts?.created ?? [];
  const draftsLink = appUrl ? `${appUrl.replace(/\/$/, '')}/#/szkice` : '';
  const draftsHtml = draftList.length
    ? `<div style="background:#E2F2EC;color:#14463a;border-radius:10px;padding:10px 14px;margin:18px 0;font-size:13px"><b>Przygotowano szkice dokumentów (${draftList.length}):</b><br>${draftList.map((d) => `${esc(d.document)}${d.status === 'no_changes' ? ' (bez zmian)' : ''}`).join('<br>')}<br>${draftsLink ? `<a href="${esc(draftsLink)}">Otwórz szkice w panelu</a>` : 'Otwórz je w panelu, w zakładce Szkice dokumentów.'}</div>`
    : '';

  const body = list.length
    ? sections
    : `<p style="font-size:15px">Nie wykryto nowych zmian prawa dotyczących placówki.</p>`;

  const html = `<!doctype html><html lang="pl"><body style="margin:0;background:#F4F5F8;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#171B26">
<div style="max-width:680px;margin:0 auto;padding:24px 16px">
  <h1 style="font-size:22px;margin:0 0 4px">Raport z ${esc(plDate(today))}</h1>
  <p style="margin:0 0 14px;color:#5C6478;font-size:13px">${esc(cfg.school.name)} · ${audience ? `dla Twojej roli (${esc(audience.roles.join(', '))}): ${list.length} ${pluralZmiana(list.length)}` : `przejrzano ${stats.reviewed ?? 0} nowych aktów z ${stats.sources ?? 0} źródeł, ${list.length} dotyczy placówki`}</p>
  ${healthHtml}${baselineHtml}${draftsHtml}${body}${upcomingHtml}
  <p style="margin:26px 0 0;font-size:12px;color:#5C6478">Streszczenia i przypisania zadań przygotował asystent AI. To pomoc w pracy, nie porada prawna: przed zmianą dokumentów sprawdź treść aktu w źródle.</p>
  ${footer ? footer.html : ''}
</div></body></html>`;

  const text = [
    `Raport z ${plDate(today)}`,
    `${cfg.school.name}`,
    '',
    ...(list.length
      ? sortChanges(list).flatMap((c) => [
          `[${PRIORITY_LABEL[c.priority].toUpperCase()}] ${c.title}`,
          `  ${c.source_name}, ${STATUS[c.status] ?? c.status}, ${deadlineText(c, today)}`,
          `  ${c.summary}`,
          ...(c.documents ?? []).length ? [`  Dokumenty: ${c.documents.join(', ')}`] : [],
          ...(c.tasks ?? []).map((t) => `  - ${t.role}: ${t.action}`),
          `  ${link(c)}`,
          '',
        ])
      : ['Nie wykryto nowych zmian prawa dotyczących placówki.', '']),
    ...(draftList.length ? [`Przygotowano szkice dokumentów (${draftList.length}):`, ...draftList.map((d) => `  ${d.document}${d.status === 'no_changes' ? ' (bez zmian)' : ''}`), ''] : []),
    ...(baselined.length ? ['Zainicjowane źródła (zmiany od następnego skanu):', ...baselined.map((h) => `  ${h.name}: zapamiętano ${h.baselined} pozycji`), ''] : []),
    ...(failed.length ? ['UWAGA, źródła z błędem:', ...failed.map((h) => `  ${h.name}: ${h.error}`), ''] : []),
    ...(upcoming.length ? ['Zbliżające się terminy:', ...upcoming.map((c) => `  ${deadlineText(c, today)}: ${c.title}`), ''] : []),
    'Streszczenia przygotował asystent AI. To nie jest porada prawna, sprawdź treść aktu w źródle.',
    ...(footer ? ['', footer.text] : []),
  ].join('\n');

  return { subject, html, text };
}
