# Ohjiya X, phase 2a: accounts, plans and gating

Status: design, not built. Scope: sign-in with Ohjiya, company plans bought on
ohjiya.sa, free vs paid gating (no voice on free), Arabic and RTL groundwork.

## 1. Pieces

| Piece | Where | Job |
|---|---|---|
| Ohjiya X app | x.ohjiya.sa (VPS, Docker) | The globe, plus a new Node server in front of it |
| Auth + billing | ohjiya.sa (WordPress, WooCommerce, Paymob) | Accounts, checkout, renewals |
| `ohjiya-x-entitlements` plugin | ohjiya.sa | Companies, plans, seats, expiry, sign-in token for x, entitlement API |

The Node server is new. Today Vite's dev server is the whole app. Production
needs a server that (a) serves the built app, (b) mounts the existing API
proxy middleware, (c) verifies sessions and plans on every route, (d) stores
per-company settings and connector credentials.

## 2. Sign-in (reuses the SSI idea, not its secret)

The site already runs "SSI - Single Sign-In Launcher": start -> central issue ->
signed token -> consume, with HMAC-SHA256, 120 s lifetime, audience binding,
one-time `jti` and a CSRF state cookie. We copy that flow for x.ohjiya.sa.

**Do not put the SSI shared secret on the VPS.** It is one secret shared by
every Ohjiya site; a leak would let anyone mint sign-in tokens for all of them.
The entitlements plugin issues x-specific tokens with its own secret
(`OHJIYA_X_SSO_SECRET`), audience `x.ohjiya.sa`, same token format.

Flow:
1. Toolbar "Sign in" -> `GET x.ohjiya.sa/auth/start` sets a state cookie, redirects to
   `ohjiya.sa/?oxe_sso=issue&return=https://x.ohjiya.sa/auth/consume&state=...`
2. WordPress login if needed, then redirect back with a signed token (email, name, wp user id, state).
3. `/auth/consume` verifies signature, audience, age, state cookie, and one-time `jti`
   (stored in the app database, not memory), then creates a session cookie
   (HttpOnly, Secure, SameSite=Lax, 12 h, sliding).
4. Register = the WordPress registration page, then the same flow.
5. Sign out clears the x session only.

## 3. Entitlement API (server to server)

`GET https://ohjiya.sa/wp-json/ohjiya-x/v1/entitlement?user=<wp user id>`
Auth: HMAC header with a separate API secret, timestamp within 60 s. Response:

```json
{
  "user_id": 42,
  "company": { "id": 7, "name": "Example Co", "role": "owner" },
  "plan": { "edition": "real_estate", "status": "active", "expires": "2027-10-27", "seats": 5 },
  "features": ["voice", "chat", "hex_layers", "connectors"],
  "version": 12
}
```

The app caches this for 10 minutes, refreshes on sign-in, and a webhook from
WordPress (`POST /api/hooks/entitlement`, HMAC signed) busts the cache the
moment an order completes or a plan expires. If WordPress is unreachable the
last good answer is used for up to 24 h, then the user drops to free.

## 4. WordPress plugin `ohjiya-x-entitlements`

Data (custom tables, not post meta, so queries stay simple):
- `oxe_company` (id, name, owner_user_id, created)
- `oxe_member` (company_id, user_id, role owner|admin|member)
- `oxe_plan` (company_id, edition, status, starts, expires, seats, order_id)

Behaviour:
- Three annual WooCommerce products, one per edition (Retail, Digital Business, Real Estate), in SAR. Order `completed` creates or extends the company plan by 12 months (renewal extends from the later of now and current expiry).
- Paymob has no automatic yearly card billing in this setup, so renewals are manual: MailPoet emails at 30, 14 and 3 days before expiry and on expiry, each with a one-click "renew" cart link.
- On expiry: status `expired`, 14-day read-only grace period, then free tier.
- Owner can invite members by email up to the seat limit (My Account tab "Ohjiya X").
- Admin screen: companies, plans, manual extend or revoke, audit log.
- Arabic first (the site locale is `ar`; TranslatePress already covers ar/en).

## 5. Feature gating (server-side, not just hidden buttons)

| Capability | Free (anonymous or signed in) | Paid edition |
|---|---|---|
| Globe, keyless layers, share links | yes | yes |
| Voice (`/api/realtime/*`) | no (route returns 402, UI hidden) | yes, per-company daily quota |
| Chat panel | no | yes (phase 2c) |
| Cost-bearing proxies (Places, Mapillary, TomTom) | no | yes, quota per company |
| Edition layers, hex tiles, connectors | no | by edition |

The existing "cross-site gate" blocks cost endpoints behind any proxy. Our
server replaces it with an authenticated check: no valid session + plan = 402.
The gate keeps its other checks (Origin, Sec-Fetch-Site).

## 6. Arabic and RTL

- Add `src/i18n/locales/ar.json`; English source text stays the key.
- `<html dir="rtl" lang="ar">` when Arabic is selected; convert physical CSS
  (`left/right`, `margin-left`) to logical properties in the HUD stylesheets.
- The globe and map do not mirror; panels, toolbar and the new chat dock do
  (dock at inline-end: right in English, left in Arabic).
- Language follows the WordPress user locale on sign-in, with a toolbar toggle.
- Voice and Atlas AI need an Arabic test pass before launch.

## 7. Build order

1. Node production server (serve build, mount proxies, session middleware, health check).
2. Entitlements plugin: tables, products, order hook, entitlement API, token issuer.
3. App: `/auth/*`, entitlement cache and webhook, toolbar sign-in, gating.
4. Renewal emails, invite flow, admin screens.
5. Arabic locale and RTL pass.
6. Staging test on a copy of ohjiya.sa, then production.

## 8. Risks and open points

- Never test the plugin on production first: stage on a copy.
- Paymob shows a *test* gateway (`paymob-33137-api-test-...`) enabled next to the
  live ones on ohjiya.sa; confirm that is intended before selling plans.
- Bundled data licences (see DATA_SOURCES.md) must be reviewed before charging.
- WordPress is a single point of failure for sign-in; cached entitlements soften this.
- Personal data (names, emails, company data) falls under Saudi PDPL: privacy
  notice, retention and deletion path are needed before launch.
