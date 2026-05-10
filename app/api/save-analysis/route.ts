import { NextRequest, NextResponse } from 'next/server';

const RATE_LIMIT_REQUESTS  = 20;
const RATE_LIMIT_WINDOW    = 60;
const MAX_TITLE_LENGTH     = 500;
const MAX_URL_LENGTH       = 2048;

const SUPABASE_URL         = process.env.FULLSCOPE_SUPABASE_URL!;
const SUPABASE_ANON_KEY    = process.env.FULLSCOPE_SUPABASE_ANON_KEY!;
const SUPABASE_SERVICE_KEY = process.env.FULLSCOPE_SUPABASE_SERVICE_KEY!;

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

async function checkRateLimit(ip: string) {
  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return { allowed: true };

  const key = `fullscope:save-analysis:${ip}`;
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
    return { allowed: count <= RATE_LIMIT_REQUESTS };
  } catch {
    return { allowed: true };
  }
}

function getIP(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  );
}

function validateArticleURL(url: string | undefined): string | null {
  if (!url) return null;
  if (typeof url !== 'string' || url.length > MAX_URL_LENGTH) return null;
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol) ? url : null;
  } catch {
    return null;
  }
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
        { error: 'Too many requests. Please wait before saving another analysis.' },
        { status: 429, headers: corsHeaders }
      );
    }

    const authHeader = request.headers.get('Authorization');
    if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized.' }, { status: 401, headers: corsHeaders });
    }

    let body: any;
    try { body = await request.json(); } catch {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400, headers: corsHeaders });
    }

    const { article_title, article_url, analysis } = body;

    if (!article_title || !analysis) {
      return NextResponse.json({ error: 'Missing required fields.' }, { status: 400, headers: corsHeaders });
    }

    if (typeof article_title !== 'string' || article_title.length > MAX_TITLE_LENGTH) {
      return NextResponse.json({ error: 'Invalid article title.' }, { status: 400, headers: corsHeaders });
    }

    if (typeof analysis !== 'object') {
      return NextResponse.json({ error: 'Invalid analysis format.' }, { status: 400, headers: corsHeaders });
    }

    const cleanURL = validateArticleURL(article_url);

    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: authHeader },
    });
    if (!userRes.ok) {
      return NextResponse.json({ error: 'Invalid token.' }, { status: 401, headers: corsHeaders });
    }
    const user = await userRes.json();

    const res = await fetch(`${SUPABASE_URL}/rest/v1/saved_analyses`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        apikey:          SUPABASE_SERVICE_KEY,
        Authorization:   `Bearer ${SUPABASE_SERVICE_KEY}`,
        Prefer:          'return=representation',
      },
      body: JSON.stringify({
        user_id:       user.id,
        article_title: article_title.trim(),
        article_url:   cleanURL,
        analysis:      JSON.stringify(analysis),
      }),
    });
    const data = await res.json();

    if (!res.ok) {
      return NextResponse.json(
        { error: 'Failed to save analysis.' },
        { status: res.status, headers: corsHeaders }
      );
    }

    return NextResponse.json({ success: true, id: data[0]?.id }, { headers: corsHeaders });

  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500, headers: corsHeaders }
    );
  }
}
