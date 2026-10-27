# Staging: test the plugin and the app together

A throwaway WordPress + WooCommerce with the entitlements plugin, a staging copy of
the app, and a mail catcher, on the same VPS. It contains no customer data and sends
no real email.

Hostnames (add two `A` records at SiteGround pointing at the VPS IP):
`wp-test.ohjiya.sa` (WordPress) and `x-test.ohjiya.sa` (app).

## Run it (on the VPS, from the repo folder)
```bash
git pull
bash deploy/staging/init-env.sh
cp deploy/sites/staging.caddy.example deploy/sites/staging.caddy
printf 'STAGING_WP_DOMAIN=wp-test.ohjiya.sa\nSTAGING_APP_DOMAIN=x-test.ohjiya.sa\n' >> deploy/.env
docker compose -f deploy/compose.yaml --env-file deploy/.env up -d --build     # recreates prod on the shared network
docker compose -f deploy/staging/compose.yaml --env-file deploy/staging/.env up -d --build
bash deploy/staging/setup.sh
bash deploy/staging/e2e.sh
```

## Then test by hand in a browser
1. https://x-test.ohjiya.sa : "Sign in / Register" chip is top right, voice button hidden.
2. Click it: WordPress login (register a new account or use `e2e-buyer`).
3. Back on the app the chip shows your name, plan "Free".
4. On https://wp-test.ohjiya.sa buy "Ohjiya X Real Estate" (Staging test payment); in wp-admin set the order to Completed.
5. Reload the app: plan shows Real Estate, voice button appears. (Voice then answers 503 "not configured": no OpenAI key on staging, which proves the plan gate passed.)
6. My Account > Ohjiya X: invite an email; register that email; it joins the team.
7. wp-admin > WooCommerce > Ohjiya X plans: add time, revoke.

## Tear down
```bash
docker compose -f deploy/staging/compose.yaml --env-file deploy/staging/.env down -v
rm deploy/sites/staging.caddy
docker compose -f deploy/compose.yaml --env-file deploy/.env exec caddy caddy reload --config /etc/caddy/Caddyfile
```
Then delete the two DNS records.
