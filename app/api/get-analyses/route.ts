import { NextRequest, NextResponse } from 'next/server';

const SUPABASE_URL = process.env.FULLSCOPE_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.FULLSCOPE_SUPABASE_ANON_KEY!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
    }

    // Get user from token
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': authHeader,
      },
    });

    if (!userRes.ok) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401, headers: corsHeaders });
    }

    const user = await userRes.json();

    // Get saved analyses for this user
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/saved_analyses?user_id=eq.${user.id}&order=created_at.desc&limit=20`,
      {
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': authHeader,
        },
      }
    );

    const data = await res.json();
    if (!res.ok) {
      return NextResponse.json({ error: 'Failed to fetch analyses' }, { status: res.status, headers: corsHeaders });
    }

    return NextResponse.json({ analyses: data }, { headers: corsHeaders });

  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500, headers: corsHeaders });
  }
}
