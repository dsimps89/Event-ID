'use strict';

require('dotenv').config();
const crypto = require('crypto');
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const Stripe = require('stripe');

const required = ['STRIPE_SECRET_KEY', 'PUBLIC_BASE_URL', 'ACCESS_COOKIE_SECRET'];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const PORT = Number(process.env.PORT || 3000);
const BASE_URL = process.env.PUBLIC_BASE_URL.replace(/\/$/, '');
const COOKIE_NAME = 'lumen_access';
const COOKIE_SECRET = process.env.ACCESS_COOKIE_SECRET;
const ACCESS_DAYS = Math.max(1, Number(process.env.ACCESS_DAYS || 30));
const UNIT_AMOUNT = Math.max(50, Number(process.env.PRODUCT_UNIT_AMOUNT || 2000));
const CURRENCY = String(process.env.PRODUCT_CURRENCY || 'cad').toLowerCase();
const PRODUCT_NAME = process.env.PRODUCT_NAME || 'LUMEN V2 Scenario Topography Experience';

app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", 'data:'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));
app.use(cookieParser());

// Stripe requires the unmodified request body for webhook signature checking.
app.post('/api/stripe-webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return res.status(503).send('Webhook secret not configured.');
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], secret);
  } catch (error) {
    return res.status(400).send(`Webhook signature error: ${error.message}`);
  }
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    console.log('Paid LUMEN order', {
      id: session.id,
      paymentStatus: session.payment_status,
      amountTotal: session.amount_total,
      currency: session.currency,
      customer: session.customer_details?.email || null
    });
  }
  res.json({ received: true });
});

app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function signPayload(payload) {
  const encoded = base64url(JSON.stringify(payload));
  const signature = crypto.createHmac('sha256', COOKIE_SECRET).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

function verifyToken(token) {
  if (!token || !token.includes('.')) return null;
  const [encoded, supplied] = token.split('.');
  const expected = crypto.createHmac('sha256', COOKIE_SECRET).update(encoded).digest('base64url');
  if (!supplied || supplied.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (!payload.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function setAccessCookie(res, checkoutSessionId) {
  const expires = Date.now() + ACCESS_DAYS * 24 * 60 * 60 * 1000;
  const token = signPayload({
    scope: 'lumen-v2',
    session: checkoutSessionId,
    issued: Date.now(),
    exp: expires
  });
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: ACCESS_DAYS * 24 * 60 * 60 * 1000,
    path: '/'
  });
}

function hasAccess(req) {
  const payload = verifyToken(req.cookies[COOKIE_NAME]);
  return payload?.scope === 'lumen-v2';
}

app.get('/api/config', (_req, res) => {
  res.json({
    currency: CURRENCY.toUpperCase(),
    unitAmount: UNIT_AMOUNT,
    formattedBasePrice: new Intl.NumberFormat('en-CA', {
      style: 'currency', currency: CURRENCY.toUpperCase()
    }).format(UNIT_AMOUNT / 100),
    automaticTax: true,
    accessDays: ACCESS_DAYS
  });
});

app.post('/api/create-checkout-session', async (req, res) => {
  try {
    const productData = { name: PRODUCT_NAME };
    if (process.env.STRIPE_TAX_CODE) productData.tax_code = process.env.STRIPE_TAX_CODE;

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{
        quantity: 1,
        price_data: {
          currency: CURRENCY,
          unit_amount: UNIT_AMOUNT,
          product_data: productData,
          tax_behavior: 'exclusive'
        }
      }],
      automatic_tax: { enabled: true },
      billing_address_collection: 'required',
      customer_creation: 'always',
      consent_collection: { terms_of_service: 'required' },
      success_url: `${BASE_URL}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${BASE_URL}/?checkout=cancelled`,
      metadata: { product: 'lumen-v2', accessDays: String(ACCESS_DAYS) }
    });

    res.json({ url: session.url });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Unable to start checkout.' });
  }
});

app.post('/api/verify-session', async (req, res) => {
  const sessionId = String(req.body?.sessionId || '');
  if (!sessionId.startsWith('cs_')) return res.status(400).json({ error: 'Invalid checkout session.' });
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const correctProduct = session.metadata?.product === 'lumen-v2';
    const correctAmount = session.amount_subtotal === UNIT_AMOUNT;
    const correctCurrency = session.currency === CURRENCY;
    const paid = session.payment_status === 'paid';

    if (!(correctProduct && correctAmount && correctCurrency && paid)) {
      return res.status(402).json({ error: 'Payment has not been verified.' });
    }
    setAccessCookie(res, session.id);
    res.json({ ok: true, redirect: '/app' });
  } catch (error) {
    console.error(error);
    res.status(400).json({ error: 'Checkout verification failed.' });
  }
});

app.get('/api/access-status', (req, res) => {
  res.json({ access: hasAccess(req) });
});

app.post('/api/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME, { path: '/' });
  res.json({ ok: true });
});

app.get('/app', (req, res) => {
  if (!hasAccess(req)) return res.redirect('/?access=required');
  res.set('Cache-Control', 'private, no-store');
  res.sendFile(path.join(__dirname, 'private', 'app.html'));
});

app.get('/download/lumen_topography_library.csv', (req, res) => {
  if (!hasAccess(req)) return res.status(401).send('Purchase access required.');
  res.download(path.join(__dirname, 'private', 'lumen_topography_library.csv'));
});

app.get('/health', (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`LUMEN V2 listening on port ${PORT}`);
});
