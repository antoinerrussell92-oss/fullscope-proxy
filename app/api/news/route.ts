import { NextRequest, NextResponse } from 'next/server';

const NEWSAPI_KEY = process.env.NEWSAPI_KEY!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category') || 'general';
    const query = searchParams.get('q') || '';

    if (!NEWSAPI_KEY) {
      return NextResponse.json({ error: 'NewsAPI key not configured' }, { status: 500, headers: corsHeaders });
    }

    let url = '';
    if (query) {
      url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&language=en&sortBy=publishedAt&pageSize=20&apiKey=${NEWSAPI_KEY}`;
    } else {
      url = `https://newsapi.org/v2/top-headlines?country=us&category=${category}&pageSize=20&apiKey=${NEWSAPI_KEY}`;
    }

    const res = await fetch(url);
    const data = await res.json();

    if (!res.ok || data.status === 'error') {
      return NextResponse.json({ error: data.message || 'NewsAPI error' }, { status: res.status, headers: corsHeaders });
    }

    return NextResponse.json({ articles: data.articles, totalResults: data.totalResults }, { headers: corsHeaders });

  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500, headers: corsHeaders });
  }
}
