// Vercel serverless function: POST /api/explain
// Turns a structured roster conflict (already detected by the deterministic
// validator) into a short plain-English explanation for an operations manager.
// The LLM never decides the roster; it only explains facts we pass in.

import Anthropic from '@anthropic-ai/sdk';

const SYSTEM = `You explain staff-roster conflicts to an operations manager at a customer-support outsourcing company.
You receive one conflict detected by a rule engine, plus the candidate fixes the engine already computed and simulated.
Write 3 short parts, plain text, no markdown headings:
1. What is wrong, in one sentence, naming the brand, process, people and date.
2. Why it happened (use only the facts given; do not invent people, rules or numbers).
3. What you recommend: pick the best of the given fixes and say why in one or two sentences. If no fix is given, say what the manager must decide (overtime, hiring, renegotiating coverage).
Keep it under 110 words.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(503).json({ error: 'AI explanations are not configured (ANTHROPIC_API_KEY missing).' });
    return;
  }
  const { issue, fixes, context } = req.body || {};
  if (!issue?.title) {
    res.status(400).json({ error: 'issue is required' });
    return;
  }

  const client = new Anthropic();
  const payload = JSON.stringify({ issue, fixes: (fixes || []).slice(0, 6), context }, null, 1).slice(0, 12000);

  try {
    const response = await client.beta.messages.create({
      model: process.env.ANTHROPIC_MODEL || 'claude-opus-5-5',
      max_tokens: 2000,
      output_config: { effort: 'low' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM,
      messages: [{ role: 'user', content: payload }],
    });
    if (response.stop_reason === 'refusal') {
      res.status(422).json({ error: 'The model declined to explain this conflict.' });
      return;
    }
    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    res.status(200).json({ text, model: response.model });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) res.status(429).json({ error: 'Rate limited, try again shortly.' });
    else if (err instanceof Anthropic.AuthenticationError) res.status(500).json({ error: 'Invalid ANTHROPIC_API_KEY on the server.' });
    else if (err instanceof Anthropic.APIError) res.status(502).json({ error: `Claude API error ${err.status}` });
    else res.status(500).json({ error: 'Unexpected error' });
  }
}
