import { NextRequest, NextResponse } from 'next/server';

const RATE_LIMIT_REQUESTS = 20;
const RATE_LIMIT_WINDOW   = 60;
const MAX_TEXT_LENGTH     = 8000;

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

async function checkRateLimit(ip: string) {
  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return { allowed: true, count: 0 };

  const key = `fullscope:analyze:${ip}`;
  try {
    const incrRes = await fetch(`${url}/incr/${key}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const { result: count } = await incrRes.json();
    if (count === 1) {
      await fetch(`${url}/expire/${key}/${RATE_LIMIT_WINDOW}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    }
    return { allowed: count <= RATE_LIMIT_REQUESTS, count };
  } catch {
    return { allowed: true, count: 0 };
  }
}

function sanitizeText(text: string): string {
  return text
    .slice(0, MAX_TEXT_LENGTH)
    .replace(/ignore previous instructions/gi, '')
    .replace(/ignore all instructions/gi, '')
    .replace(/you are now/gi, '')
    .replace(/pretend you are/gi, '')
    .replace(/jailbreak/gi, '')
    .replace(/prompt injection/gi, '')
    .trim();
}

function getIP(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  );
}

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

export async function POST(request: NextRequest) {
  try {
    const ip = getIP(request);
    const { allowed } = await checkRateLimit(ip);
    if (!allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please wait before analyzing another article.' },
        { status: 429, headers: corsHeaders }
      );
    }

    let body: any;
    try { body = await request.json(); } catch {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400, headers: corsHeaders });
    }

    const { text, max_tokens } = body;

    if (!text || typeof text !== 'string') {
      return NextResponse.json({ error: 'No text provided.' }, { status: 400, headers: corsHeaders });
    }

    const cleanText = sanitizeText(text);
    if (!cleanText) {
      return NextResponse.json({ error: 'Invalid text content.' }, { status: 400, headers: corsHeaders });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'API key not configured.' }, { status: 500, headers: corsHeaders });
    }

    const systemPrompt = `You are FullScope's media analysis engine. Analyze news articles for bias, framing, and credibility. Respond ONLY with valid JSON, no markdown, no preamble.
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
}
[USER_ARTICLE_INPUT]`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':        'application/json',
        'x-api-key':           apiKey,
        'anthropic-version':   '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-5',
        max_tokens: Math.min(max_tokens || 1200, 1500),
        system:     systemPrompt,
        messages:   [{ role: 'user', content: cleanText }],
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      return NextResponse.json(
        { error: (error as any)?.error?.message || 'Anthropic API error' },
        { status: response.status, headers: corsHeaders }
      );
    }

    const data  = await response.json();
    const raw   = data.content?.[0]?.text || '';
    const clean = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    return NextResponse.json(parsed, { headers: corsHeaders });

  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500, headers: corsHeaders }
    );
  }
}
