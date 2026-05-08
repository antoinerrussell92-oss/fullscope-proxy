import { NextRequest, NextResponse } from 'next/server';

const SUPABASE_URL = process.env.FULLSCOPE_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.FULLSCOPE_SUPABASE_ANON_KEY!;

export async function POST(request: NextRequest) {
  try {
    const { action, email, password, full_name } = await request.json();

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password required' }, { status: 400 });
    }

    if (action === 'signup') {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ email, password, data: { full_name } }),
      });
      const data = await res.json();
      if (!res.ok) return NextResponse.json({ error: data.msg || data.error_description || 'Signup failed' }, { status: res.status });
      return NextResponse.json({ message: 'Signup successful. Check your email to confirm.', user: data.user });
    }

    if (action === 'login') {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) return NextResponse.json({ error: data.error_description || 'Login failed' }, { status: res.status });
      return NextResponse.json({ access_token: data.access_token, refresh_token: data.refresh_token, user: data.user });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });

  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
