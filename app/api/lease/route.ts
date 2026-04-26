import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { imageBase64, mimeType } = await request.json();

    if (!imageBase64) {
      return NextResponse.json({ error: 'No image provided' }, { status: 400 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'API key not configured' }, { status: 500 });
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 1500,
        system: `You are Flipped's AI lease document scanner. A user has photographed their lease or buyer's order. Analyze it and respond ONLY with valid JSON, no markdown, no preamble.

Return exactly this structure:
{
  "verdict": "clean|warning|danger",
  "headline": "max 10 words summarizing the deal situation",
  "monthlyPayment": "extracted monthly payment or null",
  "moneyFactor": "extracted money factor or null",
  "residual": "extracted residual percentage or null",
  "term": "extracted term in months or null",
  "msrp": "extracted MSRP or null",
  "flags": [
    {
      "severity": "danger|warning|info",
      "title": "short flag title",
      "detail": "1-2 sentence plain English explanation of what this means for the customer"
    }
  ],
  "summary": "2-3 sentence plain English verdict on this deal — what looks good, what looks wrong, what to do next",
  "script": "exact word-for-word line the customer should say to the dealer right now"
}

If you cannot read the document clearly, return verdict: warning and explain in summary what you could and could not read.`,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: mimeType || 'image/jpeg',
                  data: imageBase64,
                },
              },
              {
                type: 'text',
                text: 'Scan this lease document and give me a complete plain-language breakdown of what I need to know.',
              },
            ],
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
