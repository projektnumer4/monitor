import { esc, PRIORITY_LABEL, STATUS_LABEL, deadlineText, todayWarsaw, plDate, toast } from './util.js';

const pr = (p) => `<span class="pr ${p}">${PRIORITY_LABEL[p] ?? p}</span>`;

/** Widok pracownika z linku: tylko do odczytu, tylko zadania jednej roli. */
export async function renderUserView({ api, root, token, now = () => new Date() }) {
  root.innerHTML = '<div class="uview"><div class="card pad stack"><div class="skeleton" style="width:50%"></div><div class="skeleton" style="width:80%"></div></div></div>';
  let view;
  try { view = await api.roleView(token); } catch (e) {
    root.innerHTML = `<div class="uview"><div class="errbox" role="alert">Nie udało się wczytać danych: ${esc(e.message)}</div></div>`;
    return;
  }
  if (!view) {
    root.innerHTML = `<div class="centered"><div class="card pad" style="max-width:440px;text-align:center"><div class="logo" style="margin:0 auto 12px">§</div><h2>Link jest nieważny</h2><p class="muted" style="margin-top:6px">Link wygasł albo został odwołany. Poproś administratora o nowy.</p></div></div>`;
    return;
  }
  const today = todayWarsaw(now());
  const items = view.changes ?? [];
  root.innerHTML = `<div class="uview">
    <div class="uhead"><div class="brand" style="padding:0"><div class="logo">§</div><div><b>Zadania dla roli</b><span>SOSW w Ostrołęce</span></div></div>
      <div class="row"><span class="ro">🔒 Tylko do odczytu</span><button class="btn sm" id="theme">Motyw</button></div></div>
    <h1>${esc(view.role)}</h1>
    <p class="muted" style="margin:6px 0 22px">Stan na ${esc(plDate(String(view.generated_at).slice(0, 10)))}. Poniżej zmiany prawa, które wymagają Twojego działania.</p>
    ${items.length ? `<div class="grid" style="gap:14px">${items.map((c) => `<div class="card pad">
      <div class="row" style="justify-content:space-between;margin-bottom:6px">${pr(c.priority)}<span class="small muted">${esc(c.effective_date ? deadlineText(c.effective_date, today) : STATUS_LABEL[c.status] === 'projekt' ? 'Projekt, bez terminu' : 'Bez terminu')}</span></div>
      <h3 style="margin-bottom:6px">${esc(c.title)}</h3>
      ${(c.tasks ?? []).map((t) => `<div class="note ${c.workflow === 'done' ? 'done-task' : ''}" style="margin:10px 0"><span>${c.workflow === 'done' ? '✅' : '☐'}</span><span><b>Do zrobienia:</b> ${esc(t.action)}${t.deadline ? ` (do ${esc(plDate(t.deadline))})` : ''}</span></div>`).join('')}
      <p class="muted small">${esc(c.summary)}</p>
      ${(c.documents ?? []).length ? `<p class="small" style="margin-top:8px"><span class="muted">Dokumenty:</span> ${c.documents.map(esc).join(', ')}</p>` : ''}
      ${c.legal_basis ? `<p class="small" style="margin-top:6px"><span class="muted">Podstawa:</span> ${esc(c.legal_basis)}</p>` : ''}
      ${c.url ? `<p class="small" style="margin-top:6px"><a href="${esc(c.url)}" target="_blank" rel="noopener noreferrer">Źródło ↗</a></p>` : ''}</div>`).join('')}</div>`
    : `<div class="card empty"><h3 style="color:var(--ink);margin-bottom:4px">Brak zadań dla tej roli</h3><p>Gdy pojawi się zmiana, która Cię dotyczy, zobaczysz ją tutaj.</p></div>`}
    <p class="muted small" style="margin-top:22px">Streszczenia przygotował asystent AI i mogą zawierać błędy. Przed zmianą dokumentów sprawdź treść aktu w źródle.</p></div>`;
  root.querySelector('#theme')?.addEventListener('click', () => {
    const r = globalThis.document.documentElement;
    const dark = r.dataset.theme ? r.dataset.theme === 'dark' : globalThis.matchMedia?.('(prefers-color-scheme:dark)').matches;
    r.dataset.theme = dark ? 'light' : 'dark';
    try { localStorage.setItem('theme', r.dataset.theme); } catch { /* brak dostępu */ }
  });
}
export { toast };
