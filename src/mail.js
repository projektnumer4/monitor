import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Wysyłka przez Resend (https://resend.com). */
export function createResendMailer({ apiKey, from, to, http }) {
  if (!apiKey) throw new Error('Brak RESEND_API_KEY');
  if (!from) throw new Error('Brak REPORT_FROM (nadawca raportu)');
  const recipients = String(to ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!recipients.length) throw new Error('Brak REPORT_TO (odbiorcy raportu)');
  return {
    name: 'resend',
    async send({ subject, html, text }) {
      await http.request('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from, to: recipients, subject, html, text }),
      });
    },
  };
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
