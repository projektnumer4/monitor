import { renderReport } from './report.js';
import { sleep } from './util.js';

const HIDDEN_WORKFLOW = new Set(['dismissed', 'done']);

/** Usuwa adresy e-mail z komunikatów błędów, żeby nie trafiały do publicznych logów GitHub Actions. */
export const scrub = (msg) => String(msg ?? '').replace(/[\w.+'-]+@[\w-]+(\.[\w-]+)+/g, '***');

/**
 * Zmiany dotyczące danego odbiorcy: tylko te, w których któraś z jego ról ma zadanie,
 * a lista zadań jest zawężona do jego ról. Zmiany odrzucone lub zamknięte przez admina są pomijane.
 */
export function changesForRecipient(changes, recipient) {
  const roles = new Set(recipient.roles ?? []);
  return changes
    .filter((c) => !HIDDEN_WORKFLOW.has(c.workflow))
    .map((c) => ({ ...c, tasks: (c.tasks ?? []).filter((t) => roles.has(t.role)) }))
    .filter((c) => c.tasks.length);
}

export const unsubscribeUrl = (appUrl, token) => `${appUrl.replace(/\/$/, '')}/#/wypisz/${token}`;

function footerFor(url) {
  const html = `<p style="margin:14px 0 0;font-size:12px;color:#5C6478;border-top:1px solid #E2E5EC;padding-top:12px">Dostajesz tę wiadomość, bo zapisano Cię na nią na Twoją prośbę. To prywatna, dobrowolna informacja pomocnicza: nie zastępuje Dziennika Ustaw ani decyzji dyrektora i nie przypisuje nikomu obowiązków służbowych.<br><a href="${url}" style="color:#5C6478">Wypisz mnie z tych wiadomości</a></p>`;
  const text = `Dostajesz tę wiadomość, bo zapisano Cię na nią na Twoją prośbę. To prywatna, dobrowolna informacja pomocnicza: nie zastępuje Dziennika Ustaw ani decyzji dyrektora i nie przypisuje nikomu obowiązków służbowych.\nWypisz się: ${url}`;
  return { html, text };
}

/**
 * Buduje wiadomości dla odbiorców. Osoba, której żadna zmiana z dzisiejszego skanu nie dotyczy, nie dostaje nic.
 * Bez appUrl nie powstaje żadna wiadomość, bo nie ma dokąd poprowadzić linku „Wypisz mnie”.
 */
export function buildRecipientMails({ cfg, today, changes, upcoming = [], recipients, appUrl }) {
  const mails = [];
  let skipped = 0;
  for (const r of recipients) {
    const mine = changesForRecipient(changes, r);
    if (!mine.length) { skipped++; continue; }
    const url = unsubscribeUrl(appUrl, r.unsub_token);
    const report = renderReport({
      cfg, today, changes: mine, upcoming: changesForRecipient(upcoming, r).filter((u) => !mine.some((m) => m.key === u.key)),
      audience: { name: r.name, roles: r.roles ?? [] }, footer: footerFor(url),
    });
    mails.push({ recipient: r, message: { ...report, to: [{ email: r.email, name: r.name }], headers: { 'List-Unsubscribe': `<${url}>` } } });
  }
  return { mails, skipped };
}

/** Wysyła spersonalizowane wiadomości. Błąd u jednej osoby nie zatrzymuje pozostałych ani nie przerywa skanu. */
export async function sendToRecipients({ mailer, store, cfg, today, changes, upcoming, appUrl, log = () => {} }) {
  const out = { sent: 0, failed: 0, skipped: 0 };
  if (!mailer.supportsRecipients || !store.listRecipients || !changes.length) return out;

  let recipients;
  try {
    recipients = (await store.listRecipients()).filter((r) => r.status === 'active' && r.email && (r.roles ?? []).length);
  } catch (e) {
    log(`UWAGA: nie udało się wczytać odbiorców (${scrub(e.message)}). Czy wykonano supabase/recipients.sql?`);
    return out;
  }
  if (!recipients.length) return out;
  if (!appUrl) {
    log('UWAGA: brak zmiennej APP_URL, więc nie wysyłam wiadomości do odbiorców (w stopce musi być link do wypisania).');
    out.skipped = recipients.length;
    return out;
  }

  const { mails, skipped } = buildRecipientMails({ cfg, today, changes, upcoming, recipients, appUrl });
  out.skipped = skipped;
  for (const { message } of mails) {
    try {
      await mailer.send(message);
      out.sent++;
    } catch (e) {
      out.failed++;
      log(`BŁĄD wysyłki do odbiorcy: ${scrub(e.message)}`);
    }
    if (mailer.delayMs) await sleep(mailer.delayMs);
  }
  log(`Odbiorcy: wysłano ${out.sent}, błędów ${out.failed}, bez zmian dla roli ${out.skipped}`);
  return out;
}
