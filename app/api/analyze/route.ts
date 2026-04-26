import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { text, system, max_tokens } = await request.json();

    if (!text || typeof text !== 'string') {
      return NextResponse.json({ error: 'No text provided' }, { status: 400 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'API key not configured' }, { status: 500 });
    }

    const systemPrompt = system || `You are FullScope's media analysis engine. Analyze news articles for bias, framing, and credibility. Respond ONLY with valid JSON, no markdown, no preamble.

Return exactly:
{
  "title": "clean headline",
  "summary": "2-3 sentence factual summary",
  "bias_lean": "left|center|right|unclear",
  "bias_score": 0-100,
  "bias_explanation": "1-2 sentences",
  "key_claims": ["claim 1", "claim 2", "claim 3"],
  "left_perspective": "left framing in 1-2 sentences",
  "center_perspective": "factual view in 1-2 sentences",
  "right_perspective": "right framing in 1-2 sentences",
  "whats_missing": "important context absent from coverage",
  "global_coverage": ["angle 1", "angle 2", "angle 3"],
  "verdict": "bottom line FullScope verdict in 1-2 sentences"
}`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: max_tokens || 1200,
        system: systemPrompt,
        messages: [{ role: 'user', content: text }],
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      return NextResponse.json({ error: error?.error?.message || 'Anthropic API error' }, { status: response.status });
    }

    const data = await response.json();
    const raw = data.content?.[0]?.text || '';
    const clean = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    return NextResponse.json(parsed);

  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
