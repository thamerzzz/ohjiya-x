#!/usr/bin/env bash
# End-to-end checks of the plugin and the app. Run on the VPS after setup.sh.
source "$(dirname "$0")/lib.sh"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  PASS  $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL  $1"; [ -n "${2:-}" ] && echo "        $2"; }
check() { # description, got, expected-substring
  if [[ "$2" == *"$3"* ]]; then ok "$1"; else bad "$1" "expected '$3' in: ${2:0:300}"; fi
}
hmac_hex() { printf '%s' "$1" | openssl dgst -sha256 -hmac "$2" -hex | awk '{print $NF}'; }
WP="https://$STAGING_WP_DOMAIN"; APP="https://$STAGING_APP_DOMAIN"
entitlement() { # user id, optional signature override
  local ts sig; ts=$(date +%s); sig=${2:-$(hmac_hex "$ts.$1" "$OXE_API_SECRET")}
  curl -sS -w '\n%{http_code}' -H "X-OXE-Timestamp: $ts" -H "X-OXE-Signature: $sig" "$WP/wp-json/ohjiya-x/v1/entitlement?user=$1"
}

echo "== 1. Reachability"
check "WordPress answers over HTTPS" "$(curl -s -o /dev/null -w '%{http_code}' "$WP/")" 200
check "App answers over HTTPS" "$(curl -s -o /dev/null -w '%{http_code}' "$APP/")" 200
check "App /api/me works, anonymous" "$(curl -s "$APP/api/me")" '"signedIn":false'
check "Voice needs sign-in (401)" "$(curl -s -o /dev/null -w '%{http_code}' "$APP/api/realtime/token")" 401
check "Provider Settings is hidden (404)" "$(curl -s -o /dev/null -w '%{http_code}' "$APP/api/setup/status")" 404

echo "== 2. Buy a plan"
USER_ID=$(wp user get e2e-buyer --field=ID 2>/dev/null || wp user create e2e-buyer e2e-buyer@example.test --role=customer --user_pass="$(openssl rand -hex 8)" --porcelain)
PRODUCT=$(wp post list --post_type=product --meta_key=_oxe_edition --meta_value=retail --field=ID | head -n1)
ORDER=$(wp wc shop_order create --user=admin --customer_id="$USER_ID" --status=processing --payment_method=bacs \
  --line_items="[{\"product_id\":$PRODUCT,\"quantity\":1}]" --billing='{"company":"E2E Test Co","email":"e2e-buyer@example.test"}' --porcelain)
echo "  order #$ORDER for user #$USER_ID"
R=$(entitlement "$USER_ID"); check "Entitlement: active" "$R" '"status":"active"'; check "Entitlement: retail edition" "$R" '"edition":"retail"'
check "Entitlement: voice feature" "$R" '"voice"'; check "Entitlement: company name" "$R" 'E2E Test Co'
check "Entitlement: owner role" "$R" '"role":"owner"'; check "Entitlement: 3 seats" "$R" '"seats":3'

echo "== 3. Same order twice adds nothing"
wp wc shop_order update "$ORDER" --user=admin --status=completed >/dev/null
EXPIRES1=$(echo "$R" | grep -o '"expires":"[^"]*"')
R2=$(entitlement "$USER_ID"); check "Expiry unchanged after completed" "$R2" "$EXPIRES1"

echo "== 4. Signature and timestamp rules"
BAD=$(entitlement "$USER_ID" "deadbeef"); check "Bad signature is 401" "$BAD" $'\n401'
OLD=$(curl -sS -w '\n%{http_code}' -H "X-OXE-Timestamp: 1000" -H "X-OXE-Signature: $(hmac_hex "1000.$USER_ID" "$OXE_API_SECRET")" "$WP/wp-json/ohjiya-x/v1/entitlement?user=$USER_ID")
check "Stale timestamp is 401" "$OLD" $'\n401'

echo "== 5. App <-> WordPress"
TS=$(date +%s); BODY="{\"user_ids\":[$USER_ID],\"version\":1}"
SIG=$(hmac_hex "$TS.$BODY" "$OXE_WEBHOOK_SECRET")
check "Signed webhook accepted (204)" "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$APP/api/hooks/entitlement" -H "X-OXE-Timestamp: $TS" -H "X-OXE-Signature: $SIG" -H 'Content-Type: application/json' --data "$BODY")" 204
check "Bad webhook rejected (401)" "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$APP/api/hooks/entitlement" -H "X-OXE-Timestamp: $TS" -H 'X-OXE-Signature: nope' --data "$BODY")" 401
STATE=$(openssl rand -hex 16)
LOC=$(curl -s -o /dev/null -D - "$WP/?oxe_sso=issue&return=https://$STAGING_APP_DOMAIN/auth/consume&state=$STATE" | tr -d '\r' | grep -i '^location:')
check "Sign-in sends a logged-out user to wp-login" "$LOC" 'wp-login.php'
check "Sign-in refuses a foreign return host (403)" "$(curl -s -o /dev/null -w '%{http_code}' "$WP/?oxe_sso=issue&return=https://evil.example/auth/consume&state=$STATE")" 403
check "Sign-in refuses http return (403)" "$(curl -s -o /dev/null -w '%{http_code}' "$WP/?oxe_sso=issue&return=http://$STAGING_APP_DOMAIN/auth/consume&state=$STATE")" 403
check "App start redirects to WordPress" "$(curl -s -o /dev/null -D - "$APP/auth/start" | tr -d '\r' | grep -i '^location:')" "$STAGING_WP_DOMAIN"

echo "== 6. Refund revokes it"
wp wc shop_order update "$ORDER" --user=admin --status=refunded >/dev/null
check "Entitlement: none after refund" "$(entitlement "$USER_ID")" '"status":"none"'

echo "== 7. Renewal reminders (one email, not three)"
mail_api messages -X DELETE >/dev/null
ORDER2=$(wp wc shop_order create --user=admin --customer_id="$USER_ID" --status=completed --payment_method=bacs \
  --line_items="[{\"product_id\":$PRODUCT,\"quantity\":1}]" --porcelain)
wp eval 'global $wpdb; $t=$wpdb->prefix."oxe_plan"; $wpdb->query("UPDATE $t SET starts=DATE_SUB(NOW(), INTERVAL 355 DAY), expires=DATE_ADD(NOW(), INTERVAL 10 DAY), notified=\"\" WHERE status=\"active\"");' >/dev/null
wp cron event run oxe_daily_check >/dev/null
wp cron event run oxe_daily_check >/dev/null
MAIL=$(mail_api messages)
check "One reminder, 'ends in 14 days'" "$MAIL" 'ends in 14 days'
COUNT=$(echo "$MAIL" | grep -o '"Subject"' | wc -l | tr -d ' ')
[ "$COUNT" = "1" ] && ok "Exactly one email after running the check twice" || bad "Exactly one email after running the check twice" "got $COUNT"
wp eval 'global $wpdb; $t=$wpdb->prefix."oxe_plan"; $wpdb->query("UPDATE $t SET starts=DATE_SUB(NOW(), INTERVAL 400 DAY), expires=DATE_SUB(NOW(), INTERVAL 1 DAY) WHERE status=\"active\"");' >/dev/null
check "Expired plan: grace, no features" "$(entitlement "$USER_ID")" '"status":"grace"'

echo
echo "Result: $PASS passed, $FAIL failed"
[ "$FAIL" = "0" ]
