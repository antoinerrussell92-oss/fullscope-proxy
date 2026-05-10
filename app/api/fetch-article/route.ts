import { NextRequest, NextResponse } from 'next/server';

const RATE_LIMIT_REQUESTS = 30;
const RATE_LIMIT_WINDOW   = 60;
const MAX_URL_LENGTH      = 2048;

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

async function checkRateLimit(ip: string) {
  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return { allowed: true };

  const key = `fullscope:fetch:${ip}`;
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

function validateURL(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  if (url.length > MAX_URL_LENGTH) return false;
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    const blocked = ['localhost', '127.0.0.1', '0.0.0.0', '::1', '169.254'];
    if (blocked.some(b => parsed.hostname.includes(b))) return false;
    return true;
  } catch {
    return false;
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
        { error: 'Too many requests. Please wait before fetching another article.' },
        { status: 429, headers: corsHeaders }
      );
    }

    let body: any;
    try { body = await request.json(); } catch {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400, headers: corsHeaders });
    }

    const { url } = body;

    if (!validateURL(url)) {
      return NextResponse.json({ error: 'Invalid or disallowed URL.' }, { status: 400, headers: corsHeaders });
    }

    const res = await fetch(url, {
      headers: {
        'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      return NextResponse.json({ error: 'Could not fetch article.' }, { status: res.status, headers: corsHeaders });
    }

    const html = await res.text();

    const titleMatch    = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title         = titleMatch ? titleMatch[1].replace(' | ', ' — ').trim() : '';
    const metaDescMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i)
                       || html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']description["']/i);
    const metaDesc      = metaDescMatch ? metaDescMatch[1].trim() : '';
    const ogImageMatch  = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i)
                       || html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i);
    const ogImage       = ogImageMatch ? ogImageMatch[1].trim() : '';

    let body2 = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
      .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
      .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, '')
      .replace(/<figure[^>]*>[\s\S]*?<\/figure>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();

    const sentences   = body2.split(/[.!?]+/).filter((s: string) => s.trim().length > 80);
    const articleText = sentences.slice(0, 20).join('. ').trim();

    if (!articleText && !metaDesc) {
      return NextResponse.json({ error: 'Could not extract article content.' }, { status: 422, headers: corsHeaders });
    }

    return NextResponse.json(
      { title, content: articleText || metaDesc, image: ogImage, description: metaDesc },
      { headers: corsHeaders }
    );

  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500, headers: corsHeaders }
    );
  }
}
