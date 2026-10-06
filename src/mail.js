import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const parseList = (to) => String(to ?? '').split(',').map((s) => s.trim()).filter(Boolean);

/** Rozbija „Nazwa <adres@domena>” albo samo „adres@domena” na { name, email }. */
export function parseSender(from, fallbackName = 'Monitor prawa') {
  const s = String(from ?? '').trim();
  const m = s.match(/^(.*?)\s*<([^>]+)>$/);
  if (m) return { name: m[1].replace(/^"|"$/g, '').trim() || fallbackName, email: m[2].trim() };
  return { name: fallbackName, email: s };
}

const asRecipients = (to) => [].concat(to).map((x) => (typeof x === 'string' ? { email: x } : x));

/**
 * Wysyłka przez Brevo (https://www.brevo.com), API transakcyjne. Darmowy plan: 300 wiadomości dziennie.
 * Nadawca (REPORT_FROM) musi być zweryfikowany w Brevo. Domena własna nie jest wymagana.
 * `send({ to })` nadpisuje domyślnych odbiorców (REPORT_TO), co służy do wysyłki do pojedynczych osób.
 */
export function createBrevoMailer({ apiKey, from, fromName, to, http }) {
  if (!apiKey) throw new Error('Brak BREVO_API_KEY');
  if (!from) throw new Error('Brak REPORT_FROM (nadawca raportu)');
  const sender = parseSender(from, fromName || 'Monitor prawa');
  if (fromName) sender.name = fromName;
  if (!/^[^@\s]+@[^@\s]+$/.test(sender.email)) throw new Error('REPORT_FROM musi być adresem e-mail, np. imie@gmail.com');
  const defaults = parseList(to);
  return {
    name: 'brevo',
    supportsRecipients: true,
    delayMs: 0,
    async send({ subject, html, text, to: override, headers }) {
      const list = override ? asRecipients(override) : defaults.map((email) => ({ email }));
      if (!list.length) throw new Error('Brak REPORT_TO (odbiorcy raportu)');
      await http.request('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': apiKey, accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ sender, to: list, subject, htmlContent: html, textContent: text, ...(headers ? { headers } : {}) }),
      });
    },
  };
}

/** Tworzy nadawcę poczty. Jedyna obsługiwana usługa to Brevo (wymaga BREVO_API_KEY). */
export function createMailerFromEnv({ env = process.env, http }) {
  return createBrevoMailer({ apiKey: env.BREVO_API_KEY, from: env.REPORT_FROM, fromName: env.REPORT_FROM_NAME, to: env.REPORT_TO, http });
}

/** Zamiast wysyłki zapisuje raport do plików (tryb próbny). */
export function createFileMailer(dir = 'out') {
  return {
    name: 'file',
    async send({ subject, html, text }) {
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, 'report.html'), html);
      await writeFile(path.join(dir, 'report.txt'), `${subject}\n\n${text}`);
    },
  };
}
