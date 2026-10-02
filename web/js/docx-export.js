/**
 * Dokument Word z PRAWDZIWYMI zmianami śledzonymi (w:ins / w:del): w Wordzie widać je w zakładce Recenzja,
 * a dyrektor może je zaakceptować lub odrzucić jak zwykłe poprawki współpracownika.
 */
export function buildDocxDocument(docx, segments, { author = 'Monitor prawa (AI)', title = 'Szkic zmian', date = new Date().toISOString() } = {}) {
  const { Document, Paragraph, TextRun, InsertedTextRun, DeletedTextRun } = docx;
  let id = 1;
  const paragraphs = [[]];
  for (const seg of segments) {
    seg.s.split('\n').forEach((line, i) => {
      if (i > 0) paragraphs.push([]);
      if (!line) return;
      const run = seg.t === 'ins' ? new InsertedTextRun({ text: line, id: id++, author, date })
        : seg.t === 'del' ? new DeletedTextRun({ text: line, id: id++, author, date })
          : new TextRun(line);
      paragraphs[paragraphs.length - 1].push(run);
    });
  }
  const children = paragraphs.filter((p) => p.length).map((p) => new Paragraph({ children: p, spacing: { after: 120 } }));
  return new Document({ creator: author, title, sections: [{ children }] });
}
