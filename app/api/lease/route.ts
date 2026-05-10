import { NextRequest, NextResponse } from 'next/server';

const RATE_LIMIT_REQUESTS = 10;
const RATE_LIMIT_WINDOW   = 60;
const MAX_IMAGE_SIZE      = 1024 * 1024 * 5;
const ALLOWED_MIME_TYPES  = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

async function checkRateLimit(ip) {
  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return { allowed: true };

  const key = `flipped:ratelimit:${ip}`;

  try {
    const incrRes = await fetch(`${url}/incr/${key}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const incrData = await incrRes.json();
    const count = incrData.result;

    if (count === 1) {
      await fetch(`${url}/expire/${key}/${RATE_LIMIT_WINDOW}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    }

    return { allowed: count <= RATE_LIMIT_REQUESTS, count, limit: RATE_LIMIT_REQUESTS };
  } catch {
    return { allowed: true };
  }
}

function sanitizeBase64(str) {
  if (typeof str !== 'string') return null;
  const cleaned = str.replace(/^data:image\/[a-z]+;base64,/, '').trim();
  if (!/^[A-Za-z0-9+/=]+$/.test(cleaned)) return null;
  return cleaned;
}

function validateMimeType(mime) {
  if (!mime) return 'image/jpeg';
  return ALLOWED_MIME_TYPES.includes(mime) ? mime : null;
}

function getIP(request) {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  );
}

export async function POST(request) {
  try {
    const ip = getIP(request);

    const { allowed, count, limit } = await checkRateLimit(ip);
    if (!allowed) {
      return NextResponse.json(
        { error: `Rate limit exceeded. Max ${limit} scans per minute. Please wait and try again.` },
        {
          status: 429,
          headers: {
            'X-RateLimit-Limit':     String(limit),
            'X-RateLimit-Remaining': '0',
            'Retry-After':           String(RATE_LIMIT_WINDOW),
          },
        }
      );
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
    }

    const { imageBase64, mimeType } = body;

    if (!imageBase64) {
      return NextResponse.json({ error: 'No image provided.' }, { status: 400 });
    }

    const cleanBase64 = sanitizeBase64(imageBase64);
    if (!cleanBase64) {
      return NextResponse.json({ error: 'Invalid image data.' }, { status: 400 });
    }

    const byteLength = Math.ceil(cleanBase64.length * 0.75);
    if (byteLength > MAX_IMAGE_SIZE) {
      return NextResponse.json({ error: 'Image too large. Maximum size is 5MB.' }, { status: 400 });
    }

    const cleanMime = validateMimeType(mimeType);
    if (!cleanMime) {
      return NextResponse.json({ error: 'Unsupported image type. Use JPEG, PNG, or WebP.' }, { status: 400 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'API key not configured.' }, { status: 500 });
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':    'application/json',
        'x-api-key':       apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-5',
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
If you cannot read the document clearly, return verdict: warning and explain in summary what you could and could not read.
[USER_IMAGE_INPUT]`,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type:       'base64',
                  media_type: cleanMime,
                  data:       cleanBase64,
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
      const err = await response.json().catch(() => ({}));
      return NextResponse.json(
        { error: err?.error?.message || 'Anthropic API error' },
        { status: response.status }
      );
    }

    const data  = await response.json();
    const raw   = data.content?.[0]?.text || '';
    const clean = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);

    return NextResponse.json(parsed, {
      headers: {
        'X-RateLimit-Limit':     String(limit),
        'X-RateLimit-Remaining': String(Math.max(0, limit - count)),
      },
    });

  } catch (error) {
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
