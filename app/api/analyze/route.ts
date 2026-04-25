import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { text } = await request.json();

    if (!text || typeof text !== 'string') {
      return NextResponse.json({ error: 'No text provided' }, { status: 400 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'API key not configured' },
        { status: 500 }
      );
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        system: `You are FullScope's media analysis engine. Analyze news articles for bias, framing, and credibility.

Always respond with ONLY a valid JSON object. No markdown, no explanation, no preamble.

Return exactly this structure:
{
  "biasRating": {
    "label": "Far Left | Left | Center-Left | Center | Center-Right | Right | Far Right",
    "score": <number -100 to 100, negative=left, positive=right>,
    "explanation": "<1-2 sentences>"
  },
  "framing": {
    "label": "<4-6 word framing summary>",
    "explanation": "<1-2 sentences describing how the story is framed>"
  },
  "emotionalLanguage": {
    "level": "Low | Medium | High",
    "examples": ["<word or phrase>", "<word or phrase>"],
    "explanation": "<1 sentence>"
  },
  "missingContext": {
    "items": ["<missing perspective or fact>", "<missing perspective or fact>", "<missing perspective or fact>"],
    "explanation": "<1 sentence>"
  },
  "credibilityScore": {
    "score": <number 0-100>,
    "label": "Low | Moderate | High | Very High",
    "explanation": "<1-2 sentences>"
  },
  "oneSentenceSummary": "<neutral, factual one-sentence summary of the article>"
}`,
        messages: [
          {
            role: 'user',
            content: `Analyze this article:\n\n${text}`,
          },
        ],
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      return NextResponse.json(
        { error: error?.error?.message || 'Anthropic API error' },
        { status: response.status }
      );
    }

    const data = await response.json();
    const raw = data.content?.[0]?.text || '';
    const clean = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);

    return NextResponse.json(parsed);
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
