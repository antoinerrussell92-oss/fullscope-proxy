import { NextRequest, NextResponse } from 'next/server';

const RATE_LIMIT_REQUESTS = 30;
const RATE_LIMIT_WINDOW   = 60;
const MAX_QUERY_LENGTH    = 200;
const ALLOWED_CATEGORIES  = ['general', 'business', 'technology', 'science', 'world', 'positive'];

const CURRENTS_API_KEY = process.env.CURRENTS_API_KEY!;

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

async function checkRateLimit(ip: string) {
  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return { allowed: true };

  const key = `fullscope:news:${ip}`;
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

function sanitizeQuery(q: string): string {
  return q
    .slice(0, MAX_QUERY_LENGTH)
    .replace(/[<>'"`;]/g, '')
    .trim();
}

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

export async function GET(request: NextRequest) {
  try {
    const ip = getIP(request);
    const { allowed } = await checkRateLimit(ip);
    if (!allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please wait before refreshing news.' },
        { status: 429, headers: corsHeaders }
      );
    }

    if (!CURRENTS_API_KEY) {
      return NextResponse.json({ error: 'Currents API key not configured.' }, { status: 500, headers: corsHeaders });
    }

    const { searchParams } = new URL(request.url);
    const rawCategory = searchParams.get('category') || 'general';
    const rawQuery    = searchParams.get('q') || '';

    const category = ALLOWED_CATEGORIES.includes(rawCategory) ? rawCategory : 'general';
    const query     = sanitizeQuery(rawQuery);

    let url = '';
    if (query) {
      url = `https://api.currentsapi.services/v1/search?keywords=${encodeURIComponent(query)}&language=en&apiKey=${CURRENTS_API_KEY}`;
    } else if (category === 'positive') {
      url = `https://api.currentsapi.services/v1/search?keywords=breakthrough&language=en&apiKey=${CURRENTS_API_KEY}`;
    } else {
      const categoryMap: Record<string, string> = {
        general:    'general',
        business:   'business',
        technology: 'technology',
        science:    'science',
        world:      'world',
      };
      const mappedCategory = categoryMap[category] || 'general';
      url = `https://api.currentsapi.services/v1/latest-news?category=${mappedCategory}&language=en&apiKey=${CURRENTS_API_KEY}`;
    }

    const res  = await fetch(url);
    const data = await res.json();

    if (!res.ok || data.status === 'error') {
      return NextResponse.json(
        { error: data.message || 'Currents API error.' },
        { status: res.status, headers: corsHeaders }
      );
    }

    const articles = (data.news || []).map((article: any) => ({
      title:       article.title,
      description: article.description,
      url:         article.url,
      urlToImage:  article.image && article.image !== 'None' ? article.image : null,
      publishedAt: article.published,
      source:      { name: article.author || 'Unknown' },
    }));

    return NextResponse.json({ articles, totalResults: articles.length }, { headers: corsHeaders });

  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500, headers: corsHeaders }
    );
  }
}
