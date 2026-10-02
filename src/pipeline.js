import { localParts, addDays } from './util.js';
import { shouldRun } from './schedule.js';
import { buildSources } from './sources/index.js';
import { scoreCandidate } from './filter.js';
import { decidePriority } from './priority.js';
import { renderReport } from './report.js';

/**
 * Jeden przebieg: pobierz nowe akty -> odfiltruj -> przeanalizuj -> nadaj priorytet -> zapisz -> wyślij raport.
 * Raport powstaje z zapisanych zmian danego dnia, więc ponowienie po nieudanej wysyłce nic nie gubi.
 */
export async function runScan({ cfg, http, store, analyzer, mailer, now = new Date(), force = false, appUrl = '', log = () => {} }) {
  const local = localParts(now, cfg.school.timezone);
  const today = local.date;

  const guard = shouldRun({ local, alreadyRan: await store.hasRun(today), force, window: cfg.schedule.window });
  if (!guard.run) {
    log(`Pomijam: ${guard.reason}`);
    return { skipped: true, reason: guard.reason };
  }
  log(`Start skanu ${today} (${guard.reason}), analizator: ${analyzer.name}, magazyn: ${store.kind}`);

  const ctx = { http, now, today, lookbackDays: cfg.schedule.lookbackDays, cfg };
  const sources = buildSources(cfg);
  const health = [];
  const toMark = [];
  let reviewed = 0;

  for (const src of sources) {
    const h = { id: src.id, name: src.name, ok: true, listed: 0, fresh: 0, analyzed: 0, failed: 0, error: null };
    health.push(h);
    try {
      const listed = await src.listNew(ctx);
      h.listed = listed.length;
      const seen = await store.getSeen(listed.map((c) => c.key));
      const fresh = listed.filter((c) => !seen.has(c.key));
      h.fresh = fresh.length;
      reviewed += fresh.length;

      for (const light of fresh) {
        try {
          const c = await src.enrich(light, ctx);
          const sc = scoreCandidate(c, cfg);
          if (sc.score < cfg.filter.minScore) {
            toMark.push({ key: c.key, source_id: src.id, title: c.title, relevant: false });
            continue;
          }
          const text = await src.loadText(c, ctx).catch((e) => ({ kind: 'none', note: e.message }));
          const a = await analyzer.analyze(c, text, sc, cfg, today);
          h.analyzed++;

          if (!a.relevant || a.affects_school === 'no') {
            toMark.push({ key: c.key, source_id: src.id, title: c.title, relevant: false });
            log(`  bez wpływu: ${c.title.slice(0, 80)}`);
            continue;
          }

          const merged = {
            ...a,
            effective_date: c.effectiveDate ?? a.effective_date,
            category: sc.category ?? 'oswiatowe',
          };
          const prio = decidePriority(merged, cfg.rules, today);
          const change = {
            key: c.key,
            source_id: src.id,
            source_name: src.name,
            title: c.title,
            url: c.url,
            published_at: c.publishedAt ?? null,
            effective_date: merged.effective_date,
            category: merged.category,
            priority: prio.priority,
            priority_reasons: prio.reasons,
            summary: a.summary,
            what_changes: a.what_changes,
            status: a.status,
            affects_school: a.affects_school,
            requires_statute_change: a.requires_statute_change,
            requires_council_resolution: a.requires_council_resolution,
            documents: a.documents,
            tasks: a.roles,
            legal_basis: a.legal_basis,
            confidence: a.confidence,
            review_note: a.review_note,
            run_date: today,
          };
          await store.saveChange(change);
          toMark.push({ key: c.key, source_id: src.id, title: c.title, relevant: true });
          log(`  [${prio.priority}] ${c.title.slice(0, 80)}`);
        } catch (e) {
          // Jedna nieudana pozycja nie przerywa reszty. Nie oznaczamy jej jako widzianej, więc wróci jutro.
          h.failed++;
          h.error = `${h.failed} pozycji nie udało się przetworzyć (ostatni błąd: ${e.message})`;
          h.ok = false;
          log(`  BŁĄD pozycji ${light.key}: ${e.message}`);
        }
      }
    } catch (e) {
      h.ok = false;
      h.error = e.message;
      log(`BŁĄD źródła ${src.name}: ${e.message}`);
    }
  }

  await store.markSeen(toMark);

  const changes = await store.listByRunDate(today);
  const upcoming = (await store.listUpcoming(today, addDays(today, cfg.schedule.upcomingDays)))
    .filter((c) => c.run_date !== today);
  const report = renderReport({ cfg, today, changes, upcoming, health, stats: { reviewed, sources: sources.length }, appUrl });

  if (changes.length || cfg.report.sendWhenEmpty || health.some((h) => !h.ok)) {
    await mailer.send(report);
    log(`Raport wysłany: ${report.subject}`);
  } else {
    log('Brak zmian, raport pominięty (report.sendWhenEmpty = false).');
  }

  const summary = { reviewed, changes: changes.length, health };
  await store.recordRun(today, summary);
  return { skipped: false, report, changes, health, summary };
}
