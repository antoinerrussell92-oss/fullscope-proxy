import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2023-10-16',
});

const PRICE_IDS: Record<string, string> = {
  plus_monthly:  'price_1TWlFBQ07WRXos3lKHGezaki',
  plus_annual:   'price_1TWlHXQ07WRXos3lJYDBSacu',
  pro_monthly:   'price_1TWlKWQ07WRXos3l0ebfdW7a',
  pro_annual:    'price_1TWlLLQ07WRXos3lXTeOwLWn',
};

export async function POST(req: NextRequest) {
  try {
    const { plan, user_email } = await req.json();

    if (!plan || !PRICE_IDS[plan]) {
      return NextResponse.json({ error: 'Invalid plan' }, { status: 400 });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: PRICE_IDS[plan], quantity: 1 }],
      customer_email: user_email || undefined,
      success_url: 'https://fullscopenews.world/app?session_id={CHECKOUT_SESSION_ID}&upgraded=true',
      cancel_url: 'https://fullscopenews.world/app?upgrade_cancelled=true',
      metadata: { plan },
    });

    return NextResponse.json({ url: session.url });
  } catch (err: any) {
    console.error('Stripe checkout error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
