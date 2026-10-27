#!/usr/bin/env bash
# One-time WordPress setup for staging: core, WooCommerce, the plugin, three edition products.
source "$(dirname "$0")/lib.sh"

echo "Waiting for the database..."
for i in $(seq 1 40); do
  wp db check >/dev/null 2>&1 && break
  sleep 3
done

if ! wp core is-installed 2>/dev/null; then
  wp core install --url="https://$STAGING_WP_DOMAIN" --title="Ohjiya staging" \
    --admin_user=admin --admin_password="$STAGING_ADMIN_PASSWORD" \
    --admin_email=staging@ohjiya.sa --skip-email
fi

wp rewrite structure '/%postname%/' --hard
wp option update users_can_register 1
wp plugin install woocommerce --activate
wp option update woocommerce_currency SAR
wp option update woocommerce_enable_guest_checkout no
wp option update woocommerce_enable_signup_and_login_from_checkout yes
wp option update woocommerce_bacs_settings '{"enabled":"yes","title":"Staging test payment"}' --format=json
wp plugin activate ohjiya-x-entitlements

make_product() { # name edition price
  local id
  id=$(wp post list --post_type=product --meta_key=_oxe_edition --meta_value="$2" --field=ID | head -n1)
  if [ -z "$id" ]; then
    wp wc product create --user=admin --name="$1" --type=simple --regular_price="$3" \
      --virtual=true --status=publish \
      --meta_data="[{\"key\":\"_oxe_edition\",\"value\":\"$2\"},{\"key\":\"_oxe_seats\",\"value\":\"3\"}]" --porcelain
  else
    echo "$id (already exists)"
  fi
}
echo "Retail product:";            make_product "Ohjiya X Retail" retail 1500
echo "Digital Business product:";  make_product "Ohjiya X Digital Business" digital_business 1800
echo "Real Estate product:";       make_product "Ohjiya X Real Estate" real_estate 2400

echo
echo "Staging WordPress: https://$STAGING_WP_DOMAIN/wp-admin  (user: admin, password: STAGING_ADMIN_PASSWORD in deploy/staging/.env)"
echo "Staging app:       https://$STAGING_APP_DOMAIN"
