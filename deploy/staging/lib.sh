# Shared helpers for setup.sh and e2e.sh. Source, do not run.
set -euo pipefail
STAGING_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$STAGING_DIR/../.."
set -a; . "$STAGING_DIR/.env"; set +a

compose() { docker compose -f deploy/staging/compose.yaml --env-file deploy/staging/.env "$@"; }
wp() { compose run --rm -T wpcli wp --path=/var/www/html "$@"; }
mail_api() { curl -fsS "http://127.0.0.1:8025/api/v1/$1" "${@:2}"; }
