import { NextRequest, NextResponse } from 'next/server';

const CURRENTS_API_KEY = process.env.CURRENTS_API_KEY!;

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
    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category') || 'general';
    const query = searchParams.get('q') || '';

    if (!CURRENTS_API_KEY) {
      return NextResponse.json({ error: 'Currents API key not configured' }, { status: 500, headers: corsHeaders });
    }

    let url = '';

    if (query) {
      url = `https://api.currentsapi.services/v1/search?keywords=${encodeURIComponent(query)}&language=en&apiKey=${CURRENTS_API_KEY}`;
    } else if (category === 'positive') {
      url = `https://api.currentsapi.services/v1/search?keywords=breakthrough&language=en&apiKey=${CURRENTS_API_KEY}`;
    } else {
      const categoryMap: Record<string, string> = {
        general: 'general',
        business: 'business',
        technology: 'technology',
        science: 'science',
        world: 'world',
      };
      const mappedCategory = categoryMap[category] || 'general';
      url = `https://api.currentsapi.services/v1/latest-news?category=${mappedCategory}&language=en&apiKey=${CURRENTS_API_KEY}`;
    }

    const res = await fetch(url);
    const data = await res.json();

    if (!res.ok || data.status === 'error') {
      return NextResponse.json({ error: data.message || 'Currents API error' }, { status: res.status, headers: corsHeaders });
    }

    const articles = (data.news || []).map((article: any) => ({
      title: article.title,
      description: article.description,
      url: article.url,
      urlToImage: article.image && article.image !== 'None' ? article.image : null,
      publishedAt: article.published,
      source: { name: article.author || 'Unknown' },
    }));

    return NextResponse.json({ articles, totalResults: articles.length }, { headers: corsHeaders });

  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500, headers: corsHeaders });
  }
}
