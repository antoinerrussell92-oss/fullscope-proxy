import { NextRequest, NextResponse } from 'next/server';

const RATE_LIMIT_REQUESTS = 10;
const RATE_LIMIT_WINDOW   = 60;

const SUPABASE_URL      = process.env.FULLSCOPE_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.FULLSCOPE_SUPABASE_ANON_KEY!;

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

async function checkRateLimit(ip: string) {
  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return { allowed: true };

  const key = `fullscope:auth:${ip}`;
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

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

export async function POST(request: NextRequest) {
  try {
    const ip = getIP(request);
    const { allowed } = await checkRateLimit(ip);
    if (!allowed) {
      return NextResponse.json(
        { error: 'Too many attempts. Please wait before trying again.' },
        { status: 429, headers: corsHeaders }
      );
    }

    let body: any;
    try { body = await request.json(); } catch {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400, headers: corsHeaders });
    }

    const { action, email, password, full_name } = body;

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password required.' }, { status: 400, headers: corsHeaders });
    }

    if (typeof email !== 'string' || typeof password !== 'string') {
      return NextResponse.json({ error: 'Invalid field types.' }, { status: 400, headers: corsHeaders });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'Invalid email format.' }, { status: 400, headers: corsHeaders });
    }

    if (password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400, headers: corsHeaders });
    }

    if (action === 'signup') {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
        body: JSON.stringify({ email, password, data: { full_name } }),
      });
      const data = await res.json();
      if (!res.ok) {
        return NextResponse.json(
          { error: data.msg || data.error_description || 'Signup failed.' },
          { status: res.status, headers: corsHeaders }
        );
      }
      return NextResponse.json(
        { message: 'Signup successful. Check your email to confirm.', user: data.user },
        { headers: corsHeaders }
      );
    }

    if (action === 'login') {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        return NextResponse.json(
          { error: data.error_description || 'Login failed.' },
          { status: res.status, headers: corsHeaders }
        );
      }
      return NextResponse.json(
        { access_token: data.access_token, refresh_token: data.refresh_token, user: data.user },
        { headers: corsHeaders }
      );
    }

    return NextResponse.json({ error: 'Invalid action.' }, { status: 400, headers: corsHeaders });

  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500, headers: corsHeaders }
    );
  }
}
