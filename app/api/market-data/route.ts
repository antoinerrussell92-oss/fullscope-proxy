import { NextRequest, NextResponse } from 'next/server';

const TWELVE_DATA_API_KEY = process.env.TWELVE_DATA_API_KEY!;
const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL!;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN!;
const CACHE_TTL = 60; // seconds

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const ALLOWED_SYMBOLS = [
  'AAPL','TSLA','AMZN','NVDA','PETR4:BVMF',
  'BTC/USD','ETH/USD','SOL/USD',
  'USD/BRL','USD/MXN','EUR/USD','GBP/USD',
];

async function getCached(key: string): Promise<any> {
  try {
    const res = await fetch(`${UPSTASH_URL}/get/${key}`, {
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
    });
    const data = await res.json();
    return data.result ? JSON.parse(data.result) : null;
  } catch { return null; }
}

async function setCache(key: string, value: any): Promise<void> {
  try {
    await fetch(`${UPSTASH_URL}/set/${key}/ex/${CACHE_TTL}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(JSON.stringify(value)),
    });
  } catch {}
}

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

    const cacheKey = `md:${symbol}:${interval}`;
    
    // Try cache first
    const cached = await getCached(cacheKey);
    if (cached) {
      return NextResponse.json({ ...cached, cached: true }, { headers: corsHeaders });
    }

    // Fetch fresh from Twelve Data
    const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=${interval}&outputsize=100&apikey=${TWELVE_DATA_API_KEY}`;
    const res = await fetch(url);
    const data = await res.json();

    if (data.status === 'error') {
      return NextResponse.json({ error: data.message }, { status: 400, headers: corsHeaders });
    }

    const candles = (data.values || []).reverse().map((v: any) => ({
      open: parseFloat(v.open),
      high: parseFloat(v.high),
      low: parseFloat(v.low),
      close: parseFloat(v.close),
      volume: parseFloat(v.volume || '0'),
      datetime: v.datetime,
    }));

    const lastPrice = candles.length > 0 ? candles[candles.length - 1].close : null;
    const response = { symbol, interval, candles, lastPrice, fetchedAt: Date.now() };

    await setCache(cacheKey, response);

    return NextResponse.json(response, { headers: corsHeaders });

  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500, headers: corsHeaders }
    );
  }
}
