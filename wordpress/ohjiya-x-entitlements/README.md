# Ohjiya X Entitlements (WordPress plugin)

Companies, annual plans, seats and sign-in for x.ohjiya.sa. See
[docs/ohjiya-x/phase2a-design.md](../../docs/ohjiya-x/phase2a-design.md).

**Status: written, syntax-checked only. Not yet run on WordPress. Test on a staging
copy of ohjiya.sa before production.**

## Install (staging first)
1. Zip the `ohjiya-x-entitlements` folder and upload it in Plugins > Add New, then activate.
2. Add to `wp-config.php` (three different random strings, 32+ characters each):
   ```php
   define( 'OXE_APP_URL',        'https://x.ohjiya.sa' );
   define( 'OXE_SSO_SECRET',     '...' );  // signs sign-in tokens
   define( 'OXE_API_SECRET',     '...' );  // app -> WordPress entitlement requests
   define( 'OXE_WEBHOOK_SECRET', '...' );  // WordPress -> app change notices
   ```
   Do not reuse the SSI plugin's secret. Generate with `openssl rand -hex 32`.
3. Create three products (Retail, Digital Business, Real Estate): virtual, SAR, annual price.
   In Product data > General set **Ohjiya X edition** and **Seats per year**.
4. Checkout must require an account (guest orders cannot create a company).

## What it does
- Paid order (processing or completed) -> one plan year per unit for the buyer's company (created on first purchase). Idempotent per order.
- Refund, cancel or failed -> revokes only that order's periods.
- Renewal adds a year starting when the current one ends. 14-day grace after expiry (no features), then free.
- Daily check emails the owner at 30 / 14 / 3 days and on expiry (Arabic or English by user locale), once per milestone.
- My Account > Ohjiya X: plan, team, email invitations (claimed when that email signs in or registers).
- WooCommerce > Ohjiya X plans: add time or revoke a period.

## Interfaces the app uses
- Sign-in: `https://ohjiya.sa/?oxe_sso=issue&return=<https://x.ohjiya.sa/auth/consume>&state=<16-128 chars>`
  returns to `return` with `oxe_token` and `state`. Token = `base64url(json).base64url(hmac_sha256(body, OXE_SSO_SECRET))`,
  payload `user_id, email, name, locale, state, iat, jti, aud`; valid 120 s, audience = app host.
- Entitlement: `GET /wp-json/ohjiya-x/v1/entitlement?user=<id>` with
  `X-OXE-Timestamp` (unix s, within 60 s) and `X-OXE-Signature` = hex `HMAC_SHA256("{ts}.{user}", OXE_API_SECRET)`.
- Webhook to `https://x.ohjiya.sa/api/hooks/entitlement`: body `{"user_ids":[...],"version":n}`,
  `X-OXE-Signature` = hex `HMAC_SHA256("{ts}.{body}", OXE_WEBHOOK_SECRET)`.

## Staging test checklist
- [ ] Activate: three `wp_oxe_*` tables exist, no PHP errors.
- [ ] Buy a plan with a test order: company + plan row appear, order note added; marking the order completed again adds nothing.
- [ ] Refund the order: plan revoked; entitlement returns `none`.
- [ ] Entitlement API: bad signature and stale timestamp return 401; valid call returns the document.
- [ ] Sign-in: wrong return host is refused (403); logged-out user goes to login and comes back with a token.
- [ ] Invite an unregistered email, register with it: membership is claimed.
- [ ] Set a plan to expire in 10 days and run the cron (`wp cron event run oxe_daily_check`): one "14 days" email, not three.
- [ ] Arabic locale: emails and My Account tab show Arabic.
