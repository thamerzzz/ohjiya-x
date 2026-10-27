# Deploying Ohjiya X to a VPS

1. **DNS (SiteGround):** add an `A` record, name `x`, value = the VPS public IP.
2. **VPS:** Ubuntu 22.04/24.04. Install Docker (`curl -fsSL https://get.docker.com | sh`),
   open ports 22, 80 and 443 only (`ufw allow OpenSSH && ufw allow 80,443/tcp && ufw enable`).
3. **Get the code:** `git clone <your repo> ohjiya-x && cd ohjiya-x && git switch rebrand/ohjiya-x`
4. **Configure:** `cp deploy/.env.example deploy/.env`, set the password hash and your API keys.
5. **Start:** `docker compose -f deploy/compose.yaml --env-file deploy/.env up -d --build`
6. **Check:** open https://x.ohjiya.sa (the certificate is issued on first visit; DNS must already resolve).

Update later: `git pull && docker compose -f deploy/compose.yaml --env-file deploy/.env up -d --build`

## Known limits behind a proxy
By design the app blocks its cost-bearing endpoints (OpenAI voice, Google Places,
Mapillary, TomTom) for requests that carry proxy forwarding headers, which Caddy adds.
Until we add our own login and quotas, voice and those layers will not work on the
public site. The globe, flights, ships, satellites and keyless layers do.

## Turning on accounts (after the WordPress plugin is live and tested on staging)
1. In `deploy/.env` set the four secrets (the first three must match `wp-config.php` on ohjiya.sa) and `OHJIYA_AUTH=on`.
2. Remove the `basic_auth` block from `deploy/Caddyfile` so the free version is public.
3. Redeploy. If a secret is missing the app refuses to start, by design: it never falls back to open access.
4. Check `https://x.ohjiya.sa/api/me` returns `{"signedIn":false,...}`, then sign in from the toolbar.
