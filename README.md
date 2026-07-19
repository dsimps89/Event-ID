# LUMEN V2 — Fill First, Pay to Export

Users complete and review the full LUMEN experience before checkout. The $20 CAD + tax purchase unlocks PNG, report, JSON, print, and CSV export access for 30 days in the verified browser.

# LUMEN V2 — $20 CAD + tax purchase build

This repository protects the LUMEN application behind a **server-verified Stripe Checkout payment**. Stripe Checkout can present Apple Pay when the buyer's browser/device supports it and Apple Pay is enabled for the merchant domain.

## Why this is not GitHub Pages-only

GitHub Pages is static hosting. A secure purchase flow requires a server to:

- Create the Checkout Session using a secret Stripe key.
- Calculate tax from the buyer's location.
- Verify that Stripe reports the session as paid.
- Issue a signed, HTTP-only access cookie.
- Keep the protected application outside the public static directory.

You can still store this project in GitHub, but deploy it to a Node-compatible host such as Render, Railway, Fly.io, or a container host.

## Price and tax

- Base price: **CAD $20.00** (`PRODUCT_UNIT_AMOUNT=2000`).
- Tax behavior: exclusive.
- Stripe Automatic Tax: enabled.
- Billing address: required so Stripe can determine the applicable jurisdiction.

Do not hard-code an Ontario or other tax rate unless every sale is legally subject to that exact rate. Configure Stripe Tax and the appropriate product tax code for the service you are selling.

## Setup

1. Create a Stripe account and activate Checkout.
2. Enable Stripe Tax and configure your registrations.
3. Enable Apple Pay / wallet payments in Stripe and register the production domain as required.
4. Copy `.env.example` to `.env` and fill in the values.
5. Run:

   ```bash
   npm install
   npm start
   ```

6. Deploy over HTTPS.
7. Add the webhook endpoint in Stripe:

   ```text
   https://YOUR-DOMAIN/api/stripe-webhook
   ```

8. Subscribe at least to `checkout.session.completed` and put the signing secret in `STRIPE_WEBHOOK_SECRET`.

## Access model

After Stripe confirms a paid Checkout Session for the correct product, amount, and currency, the server creates a signed, HTTP-only cookie. `/app` and the downloadable CSV require that cookie. Default access is 30 days and is configurable with `ACCESS_DAYS`.

For permanent accounts or cross-device access, replace the cookie-only system with customer accounts and a database-backed entitlement table.

## Production checklist

- Publish terms of sale, privacy notice, refund policy, support contact, and business identity.
- Set the correct Stripe product tax code.
- Test Apple Pay on a real HTTPS domain and supported device.
- Use Stripe test mode before live mode.
- Store completed-order records in a database through the webhook.
- Add email receipts and account recovery if access is meant to survive cookie deletion.
- Have a tax professional confirm registrations and treatment in each sales jurisdiction.
