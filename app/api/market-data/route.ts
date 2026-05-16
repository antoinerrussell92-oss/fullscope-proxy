import { NextRequest, NextResponse } from 'next/server';

const TWELVE_DATA_API_KEY = process.env.TWELVE_DATA_API_KEY!;
const CACHE_DURATION = 900; // 15 minutes in seconds

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const ALLOWED_SYMBOLS = [
  'AAPL','TSLA','AMZN','GOOGL','MSFT','NVDA','META','JPM','V','WMT',
  'BTC/USD','ETH/USD','BNB/USD','SOL/USD','XRP/USD',
  'USD/BRL','USD/MXN','EUR/USD','GBP/USD','USD/JPY',
];

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const symbol = searchParams.get('symbol') || 'AAPL';
    const interval = searchParams.get('interval') || '1h';

    if (!ALLOWED_SYMBOLS.includes(symbol)) {
      return NextResponse.json({ error: 'Symbol not allowed' }, { status: 400, headers: corsHeaders });
    }

    const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=${interval}&outputsize=50&apikey=${TWELVE_DATA_API_KEY}`;

    const res = await fetch(url, {
      next: { revalidate: CACHE_DURATION }
    });

    const data = await res.json();

    if (data.status === 'error') {
      return NextResponse.json({ error: data.message }, { status: 400, headers: corsHeaders });
    }

    const candles = (data.values || []).reverse().map((v: any) => ({
      open: parseFloat(v.open),
      high: parseFloat(v.high),
      low: parseFloat(v.low),
      close: parseFloat(v.close),
      datetime: v.datetime,
    }));

    return NextResponse.json({ symbol, candles }, {
      headers: {
        ...corsHeaders,
        'Cache-Control': `public, s-maxage=${CACHE_DURATION}`,
      }
    });

  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500, headers: corsHeaders }
    );
  }
}
