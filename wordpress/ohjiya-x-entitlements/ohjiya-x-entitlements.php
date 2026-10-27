<?php
/**
 * Plugin Name:       Ohjiya X Entitlements
 * Description:       Companies, annual plans, seats and sign-in for the Ohjiya X globe at x.ohjiya.sa. Plans are bought as WooCommerce products; renewals are manual with email reminders.
 * Version:           0.1.0
 * Requires at least: 6.4
 * Requires PHP:      7.4
 * Author:            Ohjiya
 * Text Domain:       ohjiya-x-entitlements
 *
 * Secrets live in wp-config.php, never in the database:
 *   define( 'OXE_APP_URL',        'https://x.ohjiya.sa' );
 *   define( 'OXE_SSO_SECRET',     '<random, 32+ chars>' ); // signs sign-in tokens (NOT the SSI secret)
 *   define( 'OXE_API_SECRET',     '<random, 32+ chars>' ); // app -> WordPress entitlement requests
 *   define( 'OXE_WEBHOOK_SECRET', '<random, 32+ chars>' ); // WordPress -> app change notices
 *
 * @package OhjiyaX
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'OXE_VERSION', '0.1.0' );
define( 'OXE_DIR', plugin_dir_path( __FILE__ ) );
define( 'OXE_GRACE_DAYS', 14 );

require_once OXE_DIR . 'includes/class-oxe-util.php';
require_once OXE_DIR . 'includes/class-oxe-db.php';
require_once OXE_DIR . 'includes/class-oxe-plans.php';
require_once OXE_DIR . 'includes/class-oxe-token.php';
require_once OXE_DIR . 'includes/class-oxe-webhook.php';
require_once OXE_DIR . 'includes/class-oxe-woo.php';
require_once OXE_DIR . 'includes/class-oxe-sso.php';
require_once OXE_DIR . 'includes/class-oxe-api.php';
require_once OXE_DIR . 'includes/class-oxe-renewals.php';
require_once OXE_DIR . 'includes/class-oxe-account.php';
require_once OXE_DIR . 'includes/class-oxe-admin.php';

register_activation_hook( __FILE__, array( 'OXE_DB', 'activate' ) );
register_deactivation_hook( __FILE__, array( 'OXE_Renewals', 'deactivate' ) );

add_action(
	'plugins_loaded',
	function () {
		OXE_DB::maybe_upgrade();
		OXE_Woo::init();
		OXE_SSO::init();
		OXE_API::init();
		OXE_Renewals::init();
		OXE_Account::init();
		OXE_Admin::init();
	}
);
