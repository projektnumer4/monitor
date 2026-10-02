import {
  esc, PRIORITY_LABEL, WORKFLOW_LABEL, STATUS_LABEL, CATEGORY_LABEL, todayWarsaw, daysBetween, addDays, plDate, plDateShort, plDateTime,
  deadlineText, sortChanges, pluralZmiana, slug, toast, deepClone,
} from './util.js';
import { mergeConfig, persistable } from './cfg.js';
import { resolveEdits, buildSegments, textAfter, contextFor, changeList, summarize } from './drafts-lib.js';
import { buildDocxDocument } from './docx-export.js';
import { readDocumentFile, loaders as realLoaders, downloadBlob } from './files.js';

const ico = {
  '': '<path d="M4 5h16M4 12h10M4 19h16"/>',
  zmiany: '<path d="M12 3 3 8l9 5 9-5-9-5Z"/><path d="m3 13 9 5 9-5"/>',
  szkice: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
  dokumenty: '<path d="M4 4h10l6 6v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z"/><path d="M14 4v6h6M7 14h10M7 18h6"/>',
  role: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.4 3.2-5.5 6.5-5.5s5.9 2.1 6.5 5.5M16 4.5a3.5 3.5 0 0 1 0 7M18.5 14.8c1.7.7 2.8 2.4 3 5.2"/>',
  zrodla: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.6 3.9 5.6 3.9 9s-1.3 6.4-3.9 9c-2.6-2.6-3.9-5.6-3.9-9S9.4 5.6 12 3Z"/>',
  priorytety: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
  linki: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  skany: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  ustawienia: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
};
const NAV = [['', 'Przegląd'], ['zmiany', 'Zmiany prawa'], ['szkice', 'Szkice dokumentów'], ['dokumenty', 'Dokumenty szkoły'], ['role', 'Role i zadania'], ['zrodla', 'Źródła'], ['priorytety', 'Priorytety i słowa kluczowe'], ['linki', 'Linki dla pracowników'], ['skany', 'Historia skanów'], ['ustawienia', 'Ustawienia i konto']];
const OPEN = new Set(['new', 'in_progress']);
const KW_GROUPS = [['education', 'Oświata (mocne)', 'Słowa, które same wystarczą, by akt trafił do analizy'], ['supporting', 'Pomocnicze', 'Słabsze sygnały, liczą się dopiero w połączeniu z innymi'], ['administrative', 'Prawo administracyjne', 'Tematy ogólne, które też dotyczą szkoły']];

const pr = (p) => `<span class="pr ${p}">${PRIORITY_LABEL[p] ?? p}</span>`;
const DRAFT_LABEL = { requested: 'Oczekuje', ready: 'Do przeglądu', no_changes: 'Bez zmian', failed: 'Błąd', accepted: 'Zatwierdzony', rejected: 'Odrzucony' };
const dst = (d) => `<span class="status ${d}">${DRAFT_LABEL[d] ?? d}</span>`;
const TYPE_LABEL = { replace: 'zamiana', delete: 'usunięcie', insert_after: 'dopisanie' };
const CONF_LABEL = { high: 'pewność wysoka', medium: 'pewność średnia', low: 'pewność niska' };
const wf = (w) => `<span class="status ${w}">${WORKFLOW_LABEL[w] ?? w}</span>`;

export function createAdminApp({ api: A, root, defaults, user, logout, sb, now = () => new Date(), loaders = realLoaders }) {
  const S = {
    cfg: deepClone(defaults), changes: [], runs: [], links: [], docs: [], drafts: [], docCache: null, docLoading: null, preview: null, newLink: null, factors: null,
    filter: { prio: 'all', wf: 'open', q: '' }, loading: true, error: null,
  };
  const today = () => todayWarsaw(now());

  /* ---------- dane ---------- */
  async function load() {
    S.loading = true; S.error = null; render();
    try {
      const [changes, runs, links, override, docs, drafts] = await Promise.all([A.loadChanges(), A.loadRuns(), A.listLinks(), A.loadConfigOverride(), A.listDocuments(), A.listDrafts()]);
      Object.assign(S, { changes, runs, links, docs, drafts, cfg: override ? mergeConfig(defaults, override) : deepClone(defaults) });
    } catch (e) {
      S.error = e.message;
    }
    S.loading = false;
    render();
  }

  async function saveCfg(mutate, msg = 'Zapisano') {
    const next = deepClone(S.cfg);
    mutate(next);
    await A.saveConfig(persistable(next));
    S.cfg = next;
    render();
    toast(msg);
  }

  /** Każda akcja użytkownika: błąd nie psuje widoku, tylko pokazuje komunikat. */
  const safe = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(`Błąd: ${e.message}`, 'err'); } };

  /* ---------- routing ---------- */
  const route = () => {
    const parts = (globalThis.location.hash || '').replace(/^#\/?/, '').split('/');
    return { page: parts[0] || '', arg: parts[1] ? decodeURIComponent(parts[1]) : null };
  };
  const go = (hash) => { globalThis.location.hash = hash; };

  /* ---------- wspólne elementy ---------- */
  const openChanges = () => S.changes.filter((c) => OPEN.has(c.workflow));
  const lastRun = () => S.runs[0];

  function shell(inner, page) {
    const urgent = S.changes.filter((c) => c.priority === 'hi' && OPEN.has(c.workflow)).length;
    return `<div class="shell"><aside class="side">
      <div class="brand"><div class="logo">§</div><div><b>Monitor prawa</b><span>SOSW Ostrołęka</span></div></div>
      <nav class="nav" aria-label="Główna nawigacja">${NAV.map(([k, l]) => `<a href="#/${k}" style="text-decoration:none"><button class="${page === k ? 'on' : ''}" tabindex="-1"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ico[k]}</svg>${l}${k === 'zmiany' && urgent ? `<span class="count">${urgent}</span>` : ''}${k === 'szkice' && S.drafts.filter((d) => d.status === 'ready').length ? `<span class="count" style="background:var(--accent)">${S.drafts.filter((d) => d.status === 'ready').length}</span>` : ''}</button></a>`).join('')}</nav>
      <div class="side-foot">
        <button class="btn sm" data-a="theme">Zmień motyw jasny/ciemny</button>
        <div class="userbox"><div class="avatar">${esc((user?.email ?? 'A').slice(0, 2).toUpperCase())}</div><div style="min-width:0"><b style="font-size:13px">Administrator</b><div class="muted" style="font-size:12px;overflow:hidden;text-overflow:ellipsis">${esc(user?.email ?? '')}</div></div></div>
        <button class="btn sm" data-a="logout">Wyloguj</button>
      </div></aside><main class="main" id="main">${inner}</main></div>`;
  }

  const changeRow = (c) => `<a class="item" href="#/zmiany/${encodeURIComponent(c.key)}" style="text-decoration:none;color:inherit"><span class="bar ${c.priority}"></span><div style="flex:1;min-width:0">
    <div class="row" style="justify-content:space-between;align-items:flex-start"><h3>${esc(c.title)}</h3><span class="row" style="gap:6px">${pr(c.priority)}${c.workflow !== 'new' ? wf(c.workflow) : ''}</span></div>
    <p class="muted small">${esc((c.summary ?? '').length > 160 ? `${c.summary.slice(0, 158)}…` : c.summary)}</p>
    <div class="meta"><span class="tag">${esc(CATEGORY_LABEL[c.category] ?? c.category ?? '')}</span><span class="tag">${esc(c.source_name)}</span><span class="small muted">${esc(deadlineText(c.effective_date, today()))}</span></div>
    <div class="chips" style="margin-top:8px">${(c.tasks ?? []).map((t) => `<span class="tag" style="color:var(--accent);background:var(--accent-soft);border-color:transparent">${esc(t.role)}</span>`).join('')}</div></div></a>`;

  const top = (title, sub, right = '') => `<div class="top"><div><h1>${esc(title)}</h1>${sub ? `<p class="muted">${sub}</p>` : ''}</div>${right}</div>`;

  /* ---------- strony ---------- */
  function timeline() {
    const t0 = today();
    const items = S.changes.filter((c) => c.effective_date && c.workflow !== 'dismissed' && daysBetween(t0, c.effective_date.slice(0, 10)) >= 0).sort((a, b) => a.effective_date.localeCompare(b.effective_date));
    if (!items.length) return '';
    const last = items[items.length - 1].effective_date.slice(0, 10);
    const span = Math.min(400, Math.max(120, daysBetween(t0, last) + 25));
    const end = addDays(t0, span);
    const pos = (d) => (daysBetween(t0, d.slice(0, 10)) / span) * 100;
    let ticks = '';
    const d0 = new Date(`${t0}T12:00:00Z`);
    for (let m = 1; m <= 14; m++) {
      const d = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + m, 1, 12));
      const iso = d.toISOString().slice(0, 10);
      if (iso > end) break;
      ticks += `<span class="tl-tick" style="left:${pos(iso)}%">${d.toLocaleDateString('pl-PL', { month: 'short', timeZone: 'UTC' })}</span>`;
    }
    return `<div class="card tl"><div class="row" style="justify-content:space-between;margin-bottom:6px"><h2>Najbliższe terminy wejścia w życie</h2><span class="muted small">Kliknij znacznik, aby otworzyć zmianę</span></div>
      <div class="tl-in"><div class="tl-track"></div><div class="tl-now"><span>Dziś</span></div>${ticks}
      ${items.slice(0, 12).map((c, i) => `<a class="tl-m" href="#/zmiany/${encodeURIComponent(c.key)}" style="left:${pos(c.effective_date)}%;text-decoration:none;color:inherit" aria-label="${esc(c.title)}"><span class="tl-dot ${c.priority}"></span><span class="tl-lab ${i % 2 ? 'l1' : ''}"><b>${esc(plDateShort(c.effective_date))}</b>${esc(c.title.length > 44 ? `${c.title.slice(0, 42)}…` : c.title)}</span></a>`).join('')}</div></div>`;
  }

  function systemStatus() {
    const r = lastRun();
    if (!r) return `<div class="warn" role="status">⚠️ <span>Nie ma jeszcze żadnego skanu. Uruchom <b>Dzienny skan prawa</b> w zakładce Actions na GitHubie.</span></div>`;
    const age = daysBetween(r.run_date, today());
    const bad = (r.summary?.health ?? []).filter((h) => !h.ok);
    if (age > 2) return `<div class="errbox" role="alert">⛔ <span>Ostatni skan był ${plDate(r.run_date)} (${age} dni temu). Sprawdź zakładkę Actions na GitHubie.</span></div>`;
    if (bad.length) return `<div class="warn" role="status">⚠️ <span>Ostatni skan (${plDate(r.run_date)}) zgłosił problemy ze źródłami: ${bad.map((h) => esc(h.name)).join(', ')}. Szczegóły w <a href="#/zrodla">Źródłach</a>.</span></div>`;
    return `<div class="okbox" role="status">✅ <span>Ostatni skan: ${plDate(r.run_date)}. Wszystkie źródła odpowiedziały, nowych pozycji: ${r.summary?.reviewed ?? 0}.</span></div>`;
  }

  function pDashboard() {
    const open = openChanges();
    const n = (p) => open.filter((c) => c.priority === p).length;
    return `${top('Przegląd', `Dzisiaj jest ${esc(plDate(today()))}.`)}
      <div style="margin-bottom:16px">${systemStatus()}</div>
      <div class="grid g3" style="margin-bottom:16px">
        <div class="card stat hi"><span class="n">${n('hi')}</span><span class="muted">wysoki priorytet, do obsługi</span></div>
        <div class="card stat mid"><span class="n">${n('mid')}</span><span class="muted">średni priorytet, do obsługi</span></div>
        <div class="card stat lo"><span class="n">${n('lo')}</span><span class="muted">niski priorytet, do obsługi</span></div></div>
      ${timeline()}
      <div class="card" style="margin-top:16px"><div class="pad" style="padding-bottom:8px"><h2>Do obsługi</h2></div><div class="list">${open.length ? sortChanges(open).slice(0, 8).map(changeRow).join('') : '<div class="empty">Brak otwartych zmian. Gdy skan wykryje coś nowego, pojawi się tutaj.</div>'}</div>
      ${open.length > 8 ? `<div class="pad" style="padding-top:0"><a class="btn sm" href="#/zmiany" style="text-decoration:none">Zobacz wszystkie (${open.length})</a></div>` : ''}</div>`;
  }

  function pChanges() {
    const f = S.filter;
    const q = f.q.trim().toLowerCase();
    const list = sortChanges(S.changes).filter((c) =>
      (f.prio === 'all' || c.priority === f.prio) &&
      (f.wf === 'all' || (f.wf === 'open' ? OPEN.has(c.workflow) : c.workflow === f.wf)) &&
      (!q || `${c.title} ${c.summary}`.toLowerCase().includes(q)));
    const seg = (name, opts) => `<div class="seg" role="group" aria-label="${name}">${opts.map(([k, l]) => `<button data-a="filter" data-k="${name === 'Priorytet' ? 'prio' : 'wf'}" data-v="${k}" class="${f[name === 'Priorytet' ? 'prio' : 'wf'] === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    return `${top('Zmiany prawa', 'Wszystkie wykryte zmiany dotyczące placówki.')}
      <div class="row" style="margin-bottom:16px">${seg('Priorytet', [['all', 'Wszystkie'], ['hi', 'Wysoki'], ['mid', 'Średni'], ['lo', 'Niski']])}${seg('Stan', [['open', 'Do obsługi'], ['done', 'Zrobione'], ['dismissed', 'Odrzucone'], ['all', 'Wszystkie']])}
        <input type="search" id="q" placeholder="Szukaj w tytułach…" value="${esc(f.q)}" class="grow" aria-label="Szukaj"></div>
      <div class="card"><div class="list">${list.length ? list.map(changeRow).join('') : '<div class="empty">Brak zmian w tej kategorii.</div>'}</div></div>`;
  }

  function pDetail(key) {
    const c = S.changes.find((x) => x.key === key);
    if (!c) return `<a class="back" href="#/zmiany" style="text-decoration:none">← Wróć do listy</a><div class="card empty">Nie znaleziono tej zmiany.</div>`;
    return `<a class="back" href="#/zmiany" style="text-decoration:none;display:inline-block">← Wróć do listy</a>
      <div class="row" style="margin-bottom:10px">${pr(c.priority)}${wf(c.workflow)}<span class="tag">${esc(CATEGORY_LABEL[c.category] ?? '')}</span><span class="tag">${esc(STATUS_LABEL[c.status] ?? c.status ?? '')}</span></div>
      <h1 style="max-width:780px">${esc(c.title)}</h1>
      <div class="facts"><div><span>Wejście w życie</span><b>${esc(deadlineText(c.effective_date, today()))}</b></div><div><span>Źródło</span><b>${esc(c.source_name)}</b></div><div><span>Wykryto</span><b>${esc(plDate(c.run_date))}</b></div><div><span>Pewność analizy</span><b>${esc({ high: 'wysoka', medium: 'średnia', low: 'niska' }[c.confidence] ?? '—')}</b></div></div>
      ${c.review_note ? `<div class="warn" style="margin-bottom:16px">⚠️ <span><b>Do sprawdzenia ręcznie:</b> ${esc(c.review_note)}</span></div>` : ''}
      <div class="grid g2" style="align-items:start">
        <div class="stack">
          <div class="card pad"><h2 style="margin-bottom:8px">Co się zmienia</h2><p>${esc(c.summary)}</p>${c.what_changes ? `<p style="margin-top:10px">${esc(c.what_changes)}</p>` : ''}
            <p class="muted small" style="margin-top:12px"><b style="color:var(--ink)">Priorytet:</b> ${esc((c.priority_reasons ?? []).join('; '))}</p>
            ${c.legal_basis ? `<p class="muted small" style="margin-top:6px"><b style="color:var(--ink)">Podstawa:</b> ${esc(c.legal_basis)}</p>` : ''}
            ${c.url ? `<p style="margin-top:10px"><a href="${esc(c.url)}" target="_blank" rel="noopener noreferrer">Otwórz w źródle ↗</a></p>` : ''}</div>
          <div class="card pad"><h2>Kto powinien działać</h2><div style="margin-top:6px">${(c.tasks ?? []).length ? c.tasks.map((t) => `<div class="task"><div class="rolebadge">${esc(t.role)}</div><div>${esc(t.action)}${t.deadline ? ` <span class="muted">(do ${esc(plDate(t.deadline))})</span>` : ''}</div></div>`).join('') : '<p class="muted small">Brak przypisanych zadań.</p>'}</div></div>
        </div>
        <div class="stack">
          <div class="card pad"><h2 style="margin-bottom:10px">Dokumenty do zmiany</h2>${(c.documents ?? []).length ? c.documents.map((d) => `<div class="row" style="padding:5px 0">📄 <span>${esc(d)}</span></div>`).join('') : '<p class="muted small">Żaden dokument szkoły nie wymaga zmian na tym etapie.</p>'}
            ${c.requires_council_resolution ? '<div class="note" style="margin-top:12px"><span>ℹ️</span><span>Wymaga uchwały rady pedagogicznej.</span></div>' : ''}</div>
          ${draftsCard(c)}
          <form class="card pad stack" data-form="savechange" data-key="${esc(c.key)}">
            <h2>Obsługa</h2>
            <div class="field" style="margin:0"><label for="wf">Stan</label><select id="wf" name="workflow">${Object.entries(WORKFLOW_LABEL).map(([k, l]) => `<option value="${k}" ${c.workflow === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
            <div class="field" style="margin:0"><label for="note">Notatka</label><textarea id="note" name="note" placeholder="Np. zlecono pedagogowi, termin rady 12.11">${esc(c.admin_note ?? '')}</textarea></div>
            <button class="btn pri" type="submit">Zapisz</button>
            <p class="muted small">Odrzucona zmiana znika z widoków pracowników.</p></form>
        </div></div>`;
  }

  function pRoles() {
    const open = openChanges();
    return `${top('Role i zadania', 'Stanowiska bez danych osobowych. Zadania przypisują się do ról.')}
      <form class="card pad row" data-form="addrole" style="margin-bottom:16px"><input name="name" placeholder="Nazwa nowej roli" required class="grow" aria-label="Nazwa roli"><input name="scope" placeholder="Zakres (opis dla AI, czym zajmuje się ta rola)" class="grow" style="flex:2" aria-label="Zakres"><button class="btn pri" type="submit">Dodaj rolę</button></form>
      <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(320px,1fr))">${S.cfg.roles.map((r) => {
    const t = open.flatMap((c) => (c.tasks ?? []).filter((x) => x.role === r.name).map((x) => ({ c, x })));
    return `<div class="card pad"><div class="row" style="justify-content:space-between;margin-bottom:8px"><h3>${esc(r.name)}</h3><span class="tag">${t.length} ${t.length === 1 ? 'zadanie' : 'zadań'}</span></div>
      <form data-form="saverole" data-name="${esc(r.name)}" class="stack" style="gap:8px"><textarea name="scope" style="min-height:62px" aria-label="Zakres roli ${esc(r.name)}">${esc(r.scope ?? '')}</textarea>
        <div class="row"><button class="btn sm" type="submit">Zapisz zakres</button><button class="btn sm danger" type="button" data-a="delrole" data-name="${esc(r.name)}">Usuń rolę</button></div></form>
      <div style="margin-top:10px">${t.length ? t.map((x) => `<a class="item" href="#/zmiany/${encodeURIComponent(x.c.key)}" style="padding:8px 0;text-decoration:none;color:inherit"><span class="bar ${x.c.priority}" style="min-height:30px"></span><span class="small">${esc(x.x.action)}</span></a>`).join('') : '<p class="muted small">Brak otwartych zadań.</p>'}</div></div>`;
  }).join('')}</div>
      <p class="muted small" style="margin-top:14px">Nazwy ról nie da się zmienić, bo odwołują się do nich wykryte zadania i linki. Aby zmienić nazwę, dodaj nową rolę i usuń starą.</p>`;
  }

  function pSources() {
    const health = Object.fromEntries((lastRun()?.summary?.health ?? []).map((h) => [h.id, h]));
    return `${top('Źródła', 'Skan odbywa się raz dziennie. Wyłącz źródła, których nie potrzebujesz.')}
      <div class="card" style="margin-bottom:16px">${S.cfg.sources.map((s) => {
    const h = health[s.id];
    const st = !s.enabled ? 'off' : !h ? 'off' : h.ok ? 'ok' : 'bad';
    return `<div class="rowline"><span class="dot ${st}" title="${!s.enabled ? 'wyłączone' : !h ? 'brak danych ze skanu' : h.ok ? 'działa' : 'błąd'}"></span>
      <div class="grow"><b>${esc(s.name)}</b><div class="muted small">${esc(s.type)}${s.url ? ` · ${esc(s.url)}` : ''}${h ? ` · ostatni skan: ${h.listed ?? 0} pozycji, ${h.fresh ?? 0} nowych` : ''}</div>${h && !h.ok ? `<div class="small" style="color:var(--hi)">${esc(h.error ?? 'Błąd')}</div>` : ''}${h?.baselined ? `<div class="small muted">zainicjowano: ${h.baselined} pozycji</div>` : ''}</div>
      <label class="sw"><input type="checkbox" data-c="src" data-id="${esc(s.id)}" ${s.enabled ? 'checked' : ''} aria-label="Aktywne: ${esc(s.name)}"><i></i></label>
      <button class="btn sm danger" data-a="delsrc" data-id="${esc(s.id)}">Usuń</button></div>`;
  }).join('')}</div>
      <form class="card pad row" data-form="addsrc"><input name="name" placeholder="Nazwa źródła" required class="grow" aria-label="Nazwa źródła"><input name="url" type="url" placeholder="Adres kanału RSS (https://…)" required class="grow" style="flex:2" aria-label="Adres RSS"><button class="btn pri" type="submit">Dodaj źródło RSS</button></form>`;
  }

  function pRules() {
    return `${top('Priorytety i słowa kluczowe', 'Reguły, według których system nadaje ważność nowym zmianom. Obowiązują od następnego skanu.')}
      <div class="card" style="margin-bottom:18px">${S.cfg.rules.map((r) => `<div class="rowline">
        <label class="sw"><input type="checkbox" data-c="rule" data-id="${esc(r.id)}" ${r.on ? 'checked' : ''} aria-label="Włącz regułę: ${esc(r.label)}"><i></i></label>
        <div class="grow">${esc(r.label)} ${r.num !== undefined ? `<input type="number" min="1" max="365" value="${esc(r.num)}" data-c="num" data-id="${esc(r.id)}" aria-label="Liczba dni">` : ''}</div>
        <select data-c="prio" data-id="${esc(r.id)}" aria-label="Priorytet reguły"><option value="hi" ${r.prio === 'hi' ? 'selected' : ''}>Wysoki</option><option value="mid" ${r.prio === 'mid' ? 'selected' : ''}>Średni</option><option value="lo" ${r.prio === 'lo' ? 'selected' : ''}>Niski</option></select></div>`).join('')}</div>
      ${KW_GROUPS.map(([g, title, hint]) => `<div class="card pad" style="margin-bottom:16px"><h2>${title}</h2><p class="muted small" style="margin-bottom:12px">${hint}</p>
        <div class="chips" style="margin-bottom:14px">${(S.cfg.keywords?.[g] ?? []).map((k, i) => `<span class="kw">${esc(k)}<button data-a="rmkw" data-g="${g}" data-i="${i}" aria-label="Usuń słowo ${esc(k)}">×</button></span>`).join('') || '<span class="muted small">Brak słów.</span>'}</div>
        <form class="row" data-form="addkw" data-g="${g}"><input name="kw" placeholder="Nowe słowo lub rdzeń słowa" required class="grow" aria-label="Nowe słowo"><button class="btn pri" type="submit">Dodaj</button></form></div>`).join('')}
      <p class="muted small">Wskazówka: wpisuj rdzenie słów (np. „szkoł”, „szkół”), bo polska odmiana zmienia końcówki.</p>`;
  }

  const linkStatus = (l) => (l.revoked ? ['rejected', 'Odwołany'] : l.expires_at && new Date(l.expires_at) < now() ? ['rejected', 'Wygasł'] : ['accepted', 'Aktywny']);

  function pLinks() {
    const url = S.newLink ? `${globalThis.location.origin}${globalThis.location.pathname}#/r/${S.newLink.token}` : '';
    return `${top('Linki dla pracowników', 'Każdy link otwiera widok tylko do odczytu dla jednej roli. Możesz go w każdej chwili odwołać.')}
      ${S.newLink ? `<div class="card pad stack" style="margin-bottom:16px;border-color:var(--accent)"><h2>Nowy link dla roli: ${esc(S.newLink.role)}</h2>
        <div class="linkbox" id="newlink">${esc(url)}</div>
        <div class="row"><button class="btn pri" data-a="copylink" data-url="${esc(url)}">Kopiuj link</button><button class="btn" data-a="closenew">Gotowe</button></div>
        <div class="warn">⚠️ <span>Ten link jest pokazany <b>tylko teraz</b>. W bazie zapisujemy wyłącznie jego skrót, więc później nie da się go odczytać. Jeśli go zgubisz, odwołaj i utwórz nowy.</span></div></div>` : ''}
      <form class="card pad row" data-form="newlink" style="margin-bottom:16px">
        <select name="role" aria-label="Rola">${S.cfg.roles.map((r) => `<option>${esc(r.name)}</option>`).join('')}</select>
        <input name="label" placeholder="Opis (opcjonalnie)" class="grow" aria-label="Opis">
        <select name="days" aria-label="Ważność"><option value="30">30 dni</option><option value="90">90 dni</option><option value="365" selected>rok</option><option value="">bez terminu</option></select>
        <button class="btn pri" type="submit">Utwórz link</button></form>
      <div class="card"><div class="wrap-x"><table class="tbl"><thead><tr><th>Rola</th><th>Opis</th><th>Ważny do</th><th>Ostatnio użyty</th><th>Status</th><th></th></tr></thead><tbody>
        ${S.links.length ? S.links.map((l) => { const [cls, lab] = linkStatus(l); return `<tr><td><b>${esc(l.role_name)}</b></td><td>${esc(l.label ?? '')}</td><td>${l.expires_at ? esc(plDate(l.expires_at)) : 'bez terminu'}</td><td class="muted">${l.last_used_at ? esc(plDateTime(l.last_used_at)) : 'jeszcze nie'}</td><td><span class="status ${cls === 'accepted' ? 'done' : 'dismissed'}">${lab}</span></td>
          <td style="text-align:right;white-space:nowrap">${!l.revoked ? `<button class="btn sm danger" data-a="revoke" data-id="${esc(l.id)}">Odwołaj</button> ` : ''}<button class="btn sm" data-a="dellink" data-id="${esc(l.id)}">Usuń</button></td></tr>`; }).join('') : '<tr><td colspan="6" class="muted">Nie utworzono jeszcze żadnego linku.</td></tr>'}
      </tbody></table></div></div>
      <p class="muted small" style="margin-top:12px">Każdy, kto ma link, zobaczy zadania tej roli. W systemie nie ma danych uczniów ani pracowników, ale traktuj linki jak hasła.</p>`;
  }

  function pRuns() {
    return `${top('Historia skanów', 'Ostatnie 30 skanów.')}
      <div class="card"><div class="wrap-x"><table class="tbl"><thead><tr><th>Data</th><th>Status</th><th>Nowych pozycji</th><th>Zmian dla placówki</th><th>Źródła z błędem</th></tr></thead><tbody>
      ${S.runs.length ? S.runs.map((r) => { const bad = (r.summary?.health ?? []).filter((h) => !h.ok); return `<tr><td><b>${esc(plDate(r.run_date))}</b></td><td><span class="status ${r.status === 'ok' ? 'done' : 'dismissed'}">${esc(r.status)}</span></td><td>${esc(r.summary?.reviewed ?? '—')}</td><td>${esc(r.summary?.changes ?? '—')}</td><td>${bad.length ? esc(bad.map((h) => h.name).join(', ')) : '<span class="muted">brak</span>'}</td></tr>`; }).join('') : '<tr><td colspan="5" class="muted">Brak skanów.</td></tr>'}
      </tbody></table></div></div>`;
  }

  function pSettings() {
    return `${top('Ustawienia i konto', '')}
      <form class="card pad stack" data-form="school" style="margin-bottom:16px"><h2>Placówka</h2>
        <div class="field" style="margin:0"><label for="sn">Nazwa</label><input id="sn" name="name" value="${esc(S.cfg.school?.name)}" required></div>
        <div class="field" style="margin:0"><label for="sp">Opis placówki dla analizy AI</label><textarea id="sp" name="profile" style="min-height:120px">${esc(S.cfg.school?.profile)}</textarea></div>
        <p class="muted small">Im dokładniejszy opis (typy szkół, kierunki zawodowe, internat), tym trafniejsze przypisanie zadań.</p>
        <div><button class="btn pri" type="submit">Zapisz</button></div></form>
      <div class="card pad stack" style="margin-bottom:16px"><h2>Dokumenty szkoły</h2><p class="muted small">Z tej listy AI wskazuje dokumenty do zmiany.</p>
        ${S.cfg.documents.map((d, i) => `<div class="row"><span class="grow">📄 ${esc(d.name)} ${d.needsCouncil ? '<span class="tag">uchwała rady pedagogicznej</span>' : ''}</span><button class="btn sm danger" data-a="deldoc" data-i="${i}">Usuń</button></div>`).join('')}
        <form class="row" data-form="adddoc"><input name="name" placeholder="Nazwa dokumentu" required class="grow" aria-label="Nazwa dokumentu"><label class="chk"><input type="checkbox" name="council"> wymaga uchwały rady</label><button class="btn pri" type="submit">Dodaj</button></form></div>
      <div class="card pad stack" style="margin-bottom:16px"><h2>Konto</h2>
        <p>Zalogowano jako <b>${esc(user?.email ?? '')}</b>. Drugi składnik (2FA): <b>${S.factors === null ? 'sprawdzam…' : S.factors > 0 ? 'włączony' : 'brak'}</b>.</p>
        <form class="row" data-form="password"><input type="password" name="pw" minlength="12" placeholder="Nowe hasło (min. 12 znaków)" required autocomplete="new-password" class="grow" aria-label="Nowe hasło"><button class="btn" type="submit">Zmień hasło</button></form>
        <div class="row"><button class="btn" data-a="theme">Zmień motyw</button><button class="btn" data-a="logout">Wyloguj</button></div></div>
      <div class="card pad stack"><h2>Przywracanie domyślnych</h2><p class="muted small">Usuwa wszystkie ustawienia zapisane w panelu (role, reguły, słowa kluczowe, źródła, dokumenty) i wraca do domyślnych z kodu. Wykryte zmiany i linki zostają.</p>
        <div><button class="btn danger" data-a="resetcfg">Przywróć ustawienia domyślne</button></div></div>`;
  }

  /* ---------- szkice dokumentów ---------- */
  const draftFor = (key, name) => S.drafts.find((d) => d.change_key === key && d.document_name === name);
  const docMeta = (name) => S.docs.find((d) => d.name === name);

  function draftsCard(c) {
    const names = c.documents ?? [];
    if (!names.length) return '';
    return `<div class="card pad stack"><h2>Szkice dokumentów</h2>${names.map((name) => {
      const d = draftFor(c.key, name);
      const lib = docMeta(name);
      let action;
      if (d && ['ready', 'no_changes', 'accepted', 'rejected'].includes(d.status)) action = `<a class="btn pri sm" href="#/szkice/${esc(d.id)}" style="text-decoration:none">Otwórz szkic</a>`;
      else if (d?.status === 'requested') action = '<span class="muted small">Zostanie przygotowany przy najbliższym skanie</span>';
      else if (!lib) action = '<a class="btn sm" href="#/dokumenty" style="text-decoration:none">Wgraj dokument</a>';
      else action = `<button class="btn pri sm" data-a="reqdraft" data-key="${esc(c.key)}" data-name="${esc(name)}">${d?.status === 'failed' ? 'Spróbuj ponownie' : 'Przygotuj szkic'}</button>`;
      return `<div class="row" style="justify-content:space-between;gap:8px"><span>📄 ${esc(name)} ${d ? dst(d.status) : lib ? '' : '<span class="tag">brak w bibliotece</span>'}</span>${action}</div>${d?.status === 'failed' && d.error ? `<div class="small" style="color:var(--hi)">${esc(d.error)}</div>` : ''}`;
    }).join('')}<p class="muted small">Szkice powstają automatycznie podczas dziennego skanu dla dokumentów wgranych do biblioteki.</p></div>`;
  }

  function pDocs() {
    const preview = S.preview;
    return `${top('Dokumenty szkoły', 'Wgraj tekst dokumentów, które system ma aktualizować. Na ich podstawie powstają szkice zmian.')}
      <div class="warn" style="margin-bottom:16px">⚠️ <span>Wgrywaj wyłącznie dokumenty ogólne (statut, regulaminy, procedury). <b>Bez danych osobowych</b> uczniów i pracowników.</span></div>
      <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(360px,1fr))">${S.cfg.documents.map((d) => {
    const m = docMeta(d.name);
    return `<div class="card pad stack"><div class="row" style="justify-content:space-between"><h3>${esc(d.name)}</h3>${m ? `<span class="status done">wgrany</span>` : '<span class="status dismissed">brak</span>'}</div>
      <p class="muted small">${m ? `${esc(m.chars)} znaków, zaktualizowano ${esc(plDate(m.updated_at))}` : 'Nie wgrano jeszcze tekstu tego dokumentu.'}</p>
      <div class="field" style="margin:0"><label for="f-${esc(slug(d.name))}">Plik (.docx, .txt, .md)</label><input id="f-${esc(slug(d.name))}" type="file" accept=".docx,.txt,.md" data-c="docfile" data-name="${esc(d.name)}"></div>
      <form data-form="savedoc" data-name="${esc(d.name)}" class="stack" style="gap:8px"><textarea name="content" placeholder="…albo wklej tekst dokumentu tutaj" style="min-height:90px" aria-label="Tekst dokumentu ${esc(d.name)}"></textarea><div class="row"><button class="btn sm pri" type="submit">Zapisz wklejony tekst</button>${m ? `<button class="btn sm" type="button" data-a="previewdoc" data-name="${esc(d.name)}">Podgląd</button><button class="btn sm danger" type="button" data-a="deldocfile" data-name="${esc(d.name)}">Usuń tekst</button>` : ''}</div></form></div>`;
  }).join('')}</div>
      ${preview ? `<div class="card pad stack" style="margin-top:16px"><div class="row" style="justify-content:space-between"><h2>Podgląd: ${esc(preview.name)}</h2><button class="btn sm" data-a="closepreview">Zamknij</button></div><div class="doc" style="white-space:pre-wrap;max-height:420px;overflow:auto">${esc(preview.content.slice(0, 6000))}${preview.content.length > 6000 ? '\n…' : ''}</div></div>` : ''}
      <p class="muted small" style="margin-top:14px">Plik PDF zapisz najpierw jako dokument Word albo wklej jego tekst. Zmiany w liście dokumentów (dodawanie, usuwanie nazw) są w <a href="#/ustawienia">Ustawieniach</a>.</p>`;
  }

  function pDraftList() {
    const list = [...S.drafts].sort((a, b) => ['ready', 'requested', 'failed', 'accepted', 'no_changes', 'rejected'].indexOf(a.status) - ['ready', 'requested', 'failed', 'accepted', 'no_changes', 'rejected'].indexOf(b.status));
    return `${top('Szkice dokumentów', 'Propozycje zmian w dokumentach szkoły, przygotowane na podstawie wykrytych zmian prawa. Każdą zmianę decydujesz Ty.')}
      <div class="card"><div class="wrap-x"><table class="tbl"><thead><tr><th>Dokument</th><th>Zmiana prawa</th><th>Stan</th><th>Propozycje</th><th></th></tr></thead><tbody>
      ${list.length ? list.map((d) => { const c = S.changes.find((x) => x.key === d.change_key); const m = summarize(d); return `<tr><td><b>${esc(d.document_name)}</b></td><td>${c ? `<a href="#/zmiany/${encodeURIComponent(c.key)}">${esc(c.title.length > 60 ? `${c.title.slice(0, 58)}…` : c.title)}</a>` : esc(d.change_key)}</td><td>${dst(d.status)}</td><td>${['ready', 'accepted', 'rejected', 'no_changes'].includes(d.status) ? `${m.accepted}/${m.located} przyjęte${m.unlocated ? `, ${m.unlocated} do ręcznego wstawienia` : ''}` : '—'}</td><td style="text-align:right"><a class="btn sm" href="#/szkice/${esc(d.id)}" style="text-decoration:none">Otwórz</a></td></tr>`; }).join('') : '<tr><td colspan="5" class="muted">Brak szkiców. Wgraj dokumenty do biblioteki, a system przygotuje szkice przy kolejnym skanie.</td></tr>'}
      </tbody></table></div></div>`;
  }

  function pDraft(id) {
    const d = S.drafts.find((x) => x.id === id);
    if (!d) return '<a class="back" href="#/szkice" style="text-decoration:none">← Wróć do szkiców</a><div class="card empty">Nie znaleziono tego szkicu.</div>';
    const c = S.changes.find((x) => x.key === d.change_key);
    const doc = S.docCache?.name === d.document_name ? S.docCache : null;
    const m = summarize(d);
    const stale = doc && d.doc_hash && doc.content_hash && d.doc_hash !== doc.content_hash;
    const head = `<a class="back" href="#/szkice" style="text-decoration:none;display:inline-block">← Wróć do szkiców</a>
      <div class="row" style="margin-bottom:10px">${dst(d.status)}${d.model ? `<span class="tag">${esc(d.model)}</span>` : ''}</div>
      <h1>${esc(d.document_name)}</h1>
      <p class="muted" style="margin:6px 0 16px">Zmiana prawa: ${c ? `<a href="#/zmiany/${encodeURIComponent(c.key)}">${esc(c.title)}</a>` : esc(d.change_key)}</p>`;
    if (d.status === 'requested') return `${head}<div class="card pad">Szkic oczekuje na przygotowanie. Powstanie przy najbliższym skanie albo po ręcznym uruchomieniu workflow <b>Szkice dokumentów</b> w GitHubie (Actions).</div>`;
    if (d.status === 'failed') return `${head}<div class="errbox" role="alert">${esc(d.error ?? 'Nie udało się przygotować szkicu.')}</div><p style="margin-top:12px"><button class="btn pri" data-a="regen" data-id="${esc(d.id)}">Spróbuj ponownie</button></p>`;
    const warnings = [
      stale ? '⚠️ Dokument w bibliotece zmienił się po przygotowaniu szkicu. Zmiany są odnajdywane na nowo w aktualnym tekście, ale sprawdź je uważnie.' : '',
      !doc ? 'Wczytuję dokument…' : '',
      m.unlocated ? `ℹ️ ${m.unlocated} ${m.unlocated === 1 ? 'propozycji nie udało się' : 'propozycji nie udało się'} umiejscowić w dokumencie. Wstaw ${m.unlocated === 1 ? 'ją' : 'je'} ręcznie (lista poniżej).` : '',
    ].filter(Boolean);
    const edit = (e) => {
      const ctx = doc && e.located ? contextFor(doc.content, e) : null;
      const del = e.type === 'insert_after' ? '' : e.before;
      const body = ctx
        ? `<div class="doc small" style="white-space:pre-wrap;padding:12px 14px">${esc(ctx.pre)}${e.type === 'insert_after' ? esc(e.anchor ?? '') : ''}${del ? `<del>${esc(del)}</del>` : ''}${e.type !== 'delete' ? `<ins>${esc(e.after)}</ins>` : ''}${esc(ctx.post)}</div>`
        : `<div class="doc small" style="white-space:pre-wrap;padding:12px 14px">${e.type === 'insert_after' ? `Po fragmencie: „${esc(e.anchor ?? '')}”\n` : del ? `<del>${esc(del)}</del>` : ''}${e.type !== 'delete' ? `<ins>${esc(e.after)}</ins>` : ''}</div>`;
      return `<div class="card pad stack" data-edit="${esc(e.id)}"><div class="row" style="justify-content:space-between"><b>${esc(e.section || 'Zmiana')}</b><span class="row" style="gap:6px"><span class="tag">${TYPE_LABEL[e.type]}</span><span class="tag">${CONF_LABEL[e.confidence] ?? ''}</span>${e.decision === 'accepted' ? '<span class="status done">przyjęta</span>' : e.decision === 'rejected' ? '<span class="status dismissed">odrzucona</span>' : ''}</span></div>
        ${e.located ? '' : `<div class="warn">⚠️ <span>Nie umiejscowiono w dokumencie: ${esc(e.problem ?? 'nieznany powód')}. Wstaw ręcznie.</span></div>`}
        ${body}<p class="small"><span class="muted">Uzasadnienie:</span> ${esc(e.rationale)}</p>
        <div class="row">${e.located ? `<button class="btn sm pri" data-a="decide" data-id="${esc(d.id)}" data-e="${esc(e.id)}" data-v="accepted" ${e.decision === 'accepted' ? 'disabled' : ''}>Przyjmij</button><button class="btn sm danger" data-a="decide" data-id="${esc(d.id)}" data-e="${esc(e.id)}" data-v="rejected" ${e.decision === 'rejected' ? 'disabled' : ''}>Odrzuć</button>${e.decision !== 'pending' ? `<button class="btn sm" data-a="decide" data-id="${esc(d.id)}" data-e="${esc(e.id)}" data-v="pending">Cofnij decyzję</button>` : ''}` : '<span class="muted small">Zmiana bez umiejscowienia nie wchodzi do pobranego dokumentu.</span>'}</div></div>`;
    };
    const unl = d.edits.filter((e) => !e.located);
    return `${head}
      <div class="card pad" style="margin-bottom:16px"><h2 style="margin-bottom:6px">Podsumowanie</h2><p>${esc(d.summary || '')}</p>
        <p class="muted small" style="margin-top:8px">Propozycje: ${m.total}, w tym umiejscowione: ${m.located}, przyjęte: ${m.accepted}, odrzucone: ${m.rejected}, czekające na decyzję: ${m.pending}.</p></div>
      ${warnings.map((w) => `<div class="warn" style="margin-bottom:12px">${esc(w)}</div>`).join('')}
      ${d.status === 'no_changes' ? '<div class="okbox">✅ <span>Model uznał, że ten dokument nie wymaga zmian z powodu tej zmiany prawa.</span></div>' : ''}
      <div class="row" style="margin:16px 0">${m.pending ? `<button class="btn" data-a="acceptall" data-id="${esc(d.id)}">Przyjmij wszystkie umiejscowione (${m.pending})</button>` : ''}
        <button class="btn pri" data-a="dl-docx" data-id="${esc(d.id)}" ${m.accepted ? '' : 'disabled'}>Pobierz Word ze zmianami śledzonymi</button>
        <button class="btn" data-a="dl-txt" data-id="${esc(d.id)}" ${m.accepted ? '' : 'disabled'}>Pobierz tekst po zmianach</button>
        <button class="btn" data-a="copylist" data-id="${esc(d.id)}">Kopiuj listę zmian</button></div>
      <div class="stack">${d.edits.map(edit).join('') || '<div class="card empty">Brak propozycji.</div>'}</div>
      ${unl.length ? `<div class="card pad stack" style="margin-top:16px"><h2>Do ręcznego wstawienia</h2><div class="doc small" style="white-space:pre-wrap">${esc(changeList(unl.map((e) => ({ ...e, decision: 'accepted' }))))}</div></div>` : ''}
      <div class="row" style="margin-top:18px"><button class="btn pri" data-a="draftstatus" data-id="${esc(d.id)}" data-v="accepted" ${d.status === 'accepted' ? 'disabled' : ''}>Zatwierdź szkic</button><button class="btn danger" data-a="draftstatus" data-id="${esc(d.id)}" data-v="rejected" ${d.status === 'rejected' ? 'disabled' : ''}>Odrzuć szkic</button><button class="btn" data-a="regen" data-id="${esc(d.id)}">Wygeneruj ponownie</button></div>
      <p class="muted small" style="margin-top:12px">Szkic jest propozycją asystenta AI, a nie poradą prawną. Statut zmienia rada pedagogiczna, więc plik z pobrania to materiał do jej uchwały.</p>`;
  }

  /** Do przeglądu szkicu potrzebny jest aktualny tekst dokumentu. */
  function ensureDoc(name) {
    if (S.docCache?.name === name || S.docLoading === name) return;
    S.docLoading = name;
    A.getDocument(name).then((row) => { S.docCache = row; }).catch((e) => toast(`Błąd: ${e.message}`, 'err')).finally(() => { S.docLoading = null; render(); });
  }

  const saveDecisions = async (d, edits, extra = {}) => {
    await A.updateDraft(d.id, { edits, ...extra });
    d.edits = edits; Object.assign(d, extra);
    render();
  };

  /* ---------- render ---------- */
  function render() {
    const { page, arg } = route();
    let inner;
    if (S.loading) inner = '<div class="card pad stack"><div class="skeleton" style="width:40%"></div><div class="skeleton" style="width:80%"></div><div class="skeleton" style="width:60%"></div></div>';
    else if (S.error) inner = `<div class="errbox" role="alert">Nie udało się wczytać danych: ${esc(S.error)}</div><p style="margin-top:12px"><button class="btn" data-a="reload">Spróbuj ponownie</button></p>`;
    else {
      const pages = { '': pDashboard, zmiany: () => (arg ? pDetail(arg) : pChanges()), szkice: () => (arg ? pDraft(arg) : pDraftList()), dokumenty: pDocs, role: pRoles, zrodla: pSources, priorytety: pRules, linki: pLinks, skany: pRuns, ustawienia: pSettings };
      inner = (pages[page] ?? pDashboard)();
    }
    const focusId = globalThis.document.activeElement?.id;
    root.innerHTML = shell(inner, NAV.some(([k]) => k === page) ? page : '');
    if (!S.loading && !S.error && page === 'szkice' && arg) { const dr = S.drafts.find((x) => x.id === arg); if (dr && !['requested', 'failed'].includes(dr.status)) ensureDoc(dr.document_name); }
    if (focusId === 'q') { const q = root.querySelector('#q'); q?.focus(); q?.setSelectionRange(q.value.length, q.value.length); }
  }

  /* ---------- zdarzenia ---------- */

  root.addEventListener('click', safe(async (e) => {
    const b = e.target.closest('[data-a]');
    if (!b) return;
    const a = b.dataset.a;
    const d = b.dataset;
    if (a === 'theme') {
      const r = globalThis.document.documentElement;
      const dark = r.dataset.theme ? r.dataset.theme === 'dark' : globalThis.matchMedia?.('(prefers-color-scheme:dark)').matches;
      r.dataset.theme = dark ? 'light' : 'dark';
      try { localStorage.setItem('theme', r.dataset.theme); } catch { /* brak dostępu */ }
    } else if (a === 'logout') await logout();
    else if (a === 'reload') await load();
    else if (a === 'filter') { S.filter[d.k] = d.v; render(); }
    else if (a === 'rmkw') await saveCfg((c) => { c.keywords[d.g].splice(+d.i, 1); }, 'Usunięto słowo');
    else if (a === 'delrole') { if (confirm(`Usunąć rolę „${d.name}”? Istniejące linki dla tej roli przestaną pokazywać zadania.`)) await saveCfg((c) => { c.roles = c.roles.filter((r) => r.name !== d.name); }, 'Usunięto rolę'); }
    else if (a === 'delsrc') {
      if (confirm('Usunąć to źródło?')) await saveCfg((c) => {
        c.sources = c.sources.filter((s) => s.id !== d.id);
        if ((defaults.sources ?? []).some((s) => s.id === d.id)) c.removedSources = [...new Set([...(c.removedSources ?? []), d.id])];
      }, 'Usunięto źródło');
    } else if (a === 'deldoc') await saveCfg((c) => { c.documents.splice(+d.i, 1); }, 'Usunięto dokument');
    else if (a === 'revoke') { await A.revokeLink(d.id); S.links = await A.listLinks(); render(); toast('Link odwołany'); }
    else if (a === 'dellink') { if (confirm('Usunąć ten link na stałe?')) { await A.deleteLink(d.id); S.links = await A.listLinks(); render(); toast('Link usunięty'); } }
    else if (a === 'copylink') { await globalThis.navigator?.clipboard?.writeText(d.url); toast('Skopiowano link'); }
    else if (a === 'closenew') { S.newLink = null; render(); }
    else if (a === 'reqdraft') { await A.requestDraft(d.key, d.name); S.drafts = await A.listDrafts(); render(); toast('Szkic zostanie przygotowany przy najbliższym skanie'); }
    else if (a === 'previewdoc') { S.preview = await A.getDocument(d.name); render(); }
    else if (a === 'closepreview') { S.preview = null; render(); }
    else if (a === 'deldocfile') { if (confirm(`Usunąć tekst dokumentu „${d.name}” z biblioteki?`)) { await A.deleteDocument(d.name); S.docs = await A.listDocuments(); S.preview = null; if (S.docCache?.name === d.name) S.docCache = null; render(); toast('Usunięto tekst dokumentu'); } }
    else if (a === 'decide') {
      const dr = S.drafts.find((x) => x.id === d.id);
      await saveDecisions(dr, dr.edits.map((e) => (e.id === d.e && e.located ? { ...e, decision: d.v } : e)));
    } else if (a === 'acceptall') {
      const dr = S.drafts.find((x) => x.id === d.id);
      await saveDecisions(dr, dr.edits.map((e) => (e.located && e.decision === 'pending' ? { ...e, decision: 'accepted' } : e)));
      toast('Przyjęto wszystkie umiejscowione propozycje');
    } else if (a === 'draftstatus') {
      const dr = S.drafts.find((x) => x.id === d.id);
      await saveDecisions(dr, dr.edits, { status: d.v, reviewed_at: new Date().toISOString() });
      toast(d.v === 'accepted' ? 'Szkic zatwierdzony' : 'Szkic odrzucony');
    } else if (a === 'regen') {
      const dr = S.drafts.find((x) => x.id === d.id);
      await A.requestDraft(dr.change_key, dr.document_name);
      S.drafts = await A.listDrafts(); render(); toast('Szkic zostanie przygotowany ponownie przy najbliższym skanie');
    } else if (a === 'copylist') {
      const dr = S.drafts.find((x) => x.id === d.id);
      const picked = dr.edits.some((e) => e.decision === 'accepted') ? 'accepted' : 'pending';
      await globalThis.navigator?.clipboard?.writeText(changeList(dr.edits.filter((e) => e.located), picked) || changeList(dr.edits, 'pending'));
      toast('Skopiowano listę zmian');
    } else if (a === 'dl-txt' || a === 'dl-docx') {
      const dr = S.drafts.find((x) => x.id === d.id);
      const doc = S.docCache?.name === dr.document_name ? S.docCache : await A.getDocument(dr.document_name);
      if (!doc) return toast('Dokument nie jest już w bibliotece', 'err');
      if (!resolveEdits(doc.content, dr.edits).length) return toast('Najpierw przyjmij przynajmniej jedną zmianę', 'err');
      const base = `${dr.document_name} (szkic zmian)`;
      if (a === 'dl-txt') downloadBlob(new Blob([textAfter(doc.content, dr.edits)], { type: 'text/plain;charset=utf-8' }), `${base}.txt`);
      else {
        const lib = await loaders.docx();
        const document = buildDocxDocument(lib, buildSegments(doc.content, dr.edits), { title: base, date: now().toISOString() });
        downloadBlob(await lib.Packer.toBlob(document), `${base}.docx`);
      }
      toast('Pobrano plik');
    }
    else if (a === 'resetcfg') { if (confirm('Przywrócić ustawienia domyślne? Tej operacji nie można cofnąć.')) { await A.resetConfig(); S.cfg = deepClone(defaults); render(); toast('Przywrócono ustawienia domyślne'); } }
  }));

  root.addEventListener('submit', safe(async (e) => {
    const form = e.target.closest('form[data-form]');
    if (!form) return;
    e.preventDefault();
    const f = new FormData(form);
    const name = form.dataset.form;
    const str = (k) => String(f.get(k) ?? '').trim();

    if (name === 'savechange') {
      const key = form.dataset.key;
      const workflow = str('workflow');
      const patch = { workflow, admin_note: str('note') || null, handled_at: workflow === 'done' || workflow === 'dismissed' ? new Date().toISOString() : null };
      await A.updateChange(key, patch);
      const c = S.changes.find((x) => x.key === key);
      Object.assign(c, patch);
      render(); toast('Zapisano');
    } else if (name === 'addrole') {
      const n = str('name');
      if (S.cfg.roles.some((r) => r.name.toLowerCase() === n.toLowerCase())) return toast('Taka rola już istnieje', 'err');
      await saveCfg((c) => { c.roles.push({ name: n, scope: str('scope') }); }, 'Dodano rolę');
    } else if (name === 'saverole') {
      await saveCfg((c) => { c.roles.find((r) => r.name === form.dataset.name).scope = str('scope'); }, 'Zapisano zakres');
    } else if (name === 'addsrc') {
      const url = str('url');
      if (!/^https?:\/\//i.test(url)) return toast('Adres musi zaczynać się od http:// lub https://', 'err');
      let id = `rss-${slug(str('name'))}`;
      while (S.cfg.sources.some((s) => s.id === id)) id += '-2';
      await saveCfg((c) => { c.sources.push({ id, type: 'rss', name: str('name'), url, enabled: true }); }, 'Dodano źródło');
    } else if (name === 'addkw') {
      const g = form.dataset.g;
      const kw = str('kw').toLowerCase();
      if ((S.cfg.keywords?.[g] ?? []).includes(kw)) return toast('To słowo już jest na liście', 'err');
      await saveCfg((c) => { c.keywords = c.keywords ?? {}; c.keywords[g] = [...(c.keywords[g] ?? []), kw]; }, 'Dodano słowo');
    } else if (name === 'newlink') {
      const days = str('days') ? Number(str('days')) : null;
      const { token } = await A.createLink({ role: str('role'), label: str('label'), days });
      S.links = await A.listLinks();
      S.newLink = { token, role: str('role') };
      render(); toast('Utworzono link');
    } else if (name === 'school') {
      await saveCfg((c) => { c.school = { ...c.school, name: str('name'), profile: str('profile') }; }, 'Zapisano dane placówki');
    } else if (name === 'adddoc') {
      await saveCfg((c) => { c.documents.push({ name: str('name'), needsCouncil: f.get('council') === 'on' }); }, 'Dodano dokument');
    } else if (name === 'savedoc') {
      const content = String(f.get('content') ?? '').trim();
      if (!content) return toast('Wklej tekst dokumentu', 'err');
      await A.saveDocument({ name: form.dataset.name, content });
      S.docs = await A.listDocuments(); S.docCache = null; render(); toast('Zapisano dokument');
    } else if (name === 'password') {
      const { error } = await sb.auth.updateUser({ password: String(f.get('pw')) });
      if (error) return toast(`Błąd: ${error.message}`, 'err');
      form.reset(); toast('Hasło zmienione');
    }
  }));

  root.addEventListener('change', safe(async (e) => {
    const t = e.target;
    const c = t.dataset?.c;
    if (!c) return;
    if (c === 'docfile') {
      const file = t.files?.[0];
      if (!file) return;
      const content = await readDocumentFile(file, { loadMammoth: loaders.mammoth });
      await A.saveDocument({ name: t.dataset.name, content });
      S.docs = await A.listDocuments(); S.docCache = null; render();
      return toast(`Wgrano dokument (${content.length} znaków)`);
    }
    if (c === 'src') await saveCfg((cfg) => { cfg.sources.find((s) => s.id === t.dataset.id).enabled = t.checked; }, t.checked ? 'Źródło włączone' : 'Źródło wyłączone');
    else if (c === 'rule') await saveCfg((cfg) => { cfg.rules.find((r) => r.id === t.dataset.id).on = t.checked; }, 'Zapisano regułę');
    else if (c === 'prio') await saveCfg((cfg) => { cfg.rules.find((r) => r.id === t.dataset.id).prio = t.value; }, 'Zmieniono priorytet reguły');
    else if (c === 'num') {
      const v = Math.min(365, Math.max(1, Number(t.value) || 30));
      await saveCfg((cfg) => { cfg.rules.find((r) => r.id === t.dataset.id).num = v; }, 'Zapisano próg dni');
    }
  }));

  root.addEventListener('input', (e) => {
    if (e.target.id === 'q') { S.filter.q = e.target.value; render(); }
  });

  globalThis.window?.addEventListener('hashchange', render);

  return {
    start: async () => {
      await load();
      try { S.factors = (await sb.auth.mfa.listFactors()).data?.totp?.length ?? 0; } catch { S.factors = 0; }
      render();
    },
    state: S,
    render,
  };
}
export { pluralZmiana };
