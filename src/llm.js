/**
 * Wspólny klient modeli językowych zwracający JSON (do szkiców dokumentów).
 * Obsługuje Gemini (darmowy poziom) i Claude. Tryb "rules" nie ma AI, więc szkiców nie tworzy.
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createJsonLlm({ env = process.env, http, minIntervalMs }) {
  const provider = (env.AI_PROVIDER || '').toLowerCase()
    || (env.GEMINI_API_KEY ? 'gemini' : env.ANTHROPIC_API_KEY ? 'claude' : 'rules');
  if (provider === 'rules') return null;

  if (provider === 'gemini') {
    if (!env.GEMINI_API_KEY) throw new Error('Brak GEMINI_API_KEY');
    const model = env.GEMINI_MODEL || 'gemini-3.5-flash';
    let last = 0;
    const gap = minIntervalMs ?? 6000;
    return {
      name: `gemini:${model}`,
      async json({ system, user, schema: _s, instruction }) {
        const wait = last + gap - Date.now();
        if (wait > 0) await sleep(wait);
        last = Date.now();
        const res = await http.request(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: `${system}\n\n${instruction}` }] },
            contents: [{ role: 'user', parts: [{ text: user }] }],
            generationConfig: { responseMimeType: 'application/json', temperature: 0.1, maxOutputTokens: 16000 },
          }),
        });
        const data = await res.json();
        const cand = data.candidates?.[0];
        const text = (cand?.content?.parts ?? []).map((p) => p.text ?? '').join('');
        if (!text) throw new Error(`Gemini nie zwrócił wyniku (${data.promptFeedback?.blockReason || cand?.finishReason || 'brak odpowiedzi'})`);
        if (cand?.finishReason === 'MAX_TOKENS') throw new Error('Odpowiedź modelu została ucięta (za długa)');
        return parseJson(text);
      },
    };
  }

  if (provider === 'claude') {
    if (!env.ANTHROPIC_API_KEY) throw new Error('Brak ANTHROPIC_API_KEY');
    const model = env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
    return {
      name: `claude:${model}`,
      async json({ system, user, schema }) {
        const res = await http.request('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({
            model, max_tokens: 16000, system,
            tools: [{ name: 'zwroc_wynik', description: 'Zwraca wynik w ustalonym formacie.', input_schema: schema }],
            tool_choice: { type: 'tool', name: 'zwroc_wynik' },
            messages: [{ role: 'user', content: user }],
          }),
        });
        const data = await res.json();
        const block = (data.content ?? []).find((b) => b.type === 'tool_use');
        if (!block) throw new Error(`Model nie zwrócił wyniku (stop_reason: ${data.stop_reason})`);
        return block.input;
      },
    };
  }
  throw new Error(`Nieznany AI_PROVIDER: ${provider}`);
}

export function parseJson(text) {
  const cleaned = String(text).replace(/```(?:json)?/gi, '');
  const a = cleaned.indexOf('{');
  const b = cleaned.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('Odpowiedź modelu nie zawiera obiektu JSON');
  return JSON.parse(cleaned.slice(a, b + 1));
}
