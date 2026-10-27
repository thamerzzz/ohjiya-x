#!/usr/bin/env bash
# Writes deploy/staging/.env with fresh random secrets. Refuses to overwrite.
set -euo pipefail
cd "$(dirname "$0")"
[ -e .env ] && { echo ".env already exists; delete it first to regenerate."; exit 1; }
r() { openssl rand -hex 32; }
cat > .env <<ENV
STAGING_WP_DOMAIN=wp-test.ohjiya.sa
STAGING_APP_DOMAIN=x-test.ohjiya.sa
STAGING_DB_ROOT_PASSWORD=$(r)
STAGING_DB_PASSWORD=$(r)
STAGING_ADMIN_PASSWORD=$(r | cut -c1-24)
OXE_SSO_SECRET=$(r)
OXE_API_SECRET=$(r)
OXE_WEBHOOK_SECRET=$(r)
OHJIYA_SESSION_SECRET=$(r)
ENV
chmod 600 .env
echo "Wrote deploy/staging/.env (admin password is STAGING_ADMIN_PASSWORD inside it)."
