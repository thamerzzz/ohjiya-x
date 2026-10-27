<?php
/**
 * Database tables.
 *
 * @package OhjiyaX
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OXE_DB {

	const SCHEMA_VERSION = '1';

	public static function table( $name ) {
		global $wpdb;
		return $wpdb->prefix . 'oxe_' . $name;
	}

	public static function activate() {
		self::install();
		OXE_Renewals::schedule();
		OXE_Account::add_endpoint();
		OXE_Account::ensure_page();
		flush_rewrite_rules();
	}

	public static function maybe_upgrade() {
		if ( get_option( 'oxe_schema_version' ) !== self::SCHEMA_VERSION ) {
			self::install();
		}
	}

	private static function install() {
		global $wpdb;
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		$charset = $wpdb->get_charset_collate();
		$company = self::table( 'company' );
		$member  = self::table( 'member' );
		$plan    = self::table( 'plan' );

		dbDelta(
			"CREATE TABLE {$company} (
				id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
				name VARCHAR(190) NOT NULL,
				owner_user_id BIGINT UNSIGNED NOT NULL,
				created DATETIME NOT NULL,
				PRIMARY KEY  (id),
				KEY owner_user_id (owner_user_id)
			) {$charset};"
		);
		dbDelta(
			"CREATE TABLE {$member} (
				id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
				company_id BIGINT UNSIGNED NOT NULL,
				user_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
				invite_email VARCHAR(190) NOT NULL DEFAULT '',
				role VARCHAR(20) NOT NULL DEFAULT 'member',
				created DATETIME NOT NULL,
				PRIMARY KEY  (id),
				KEY company_id (company_id),
				KEY user_id (user_id),
				KEY invite_email (invite_email)
			) {$charset};"
		);
		dbDelta(
			"CREATE TABLE {$plan} (
				id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
				company_id BIGINT UNSIGNED NOT NULL,
				edition VARCHAR(32) NOT NULL,
				status VARCHAR(16) NOT NULL DEFAULT 'active',
				starts DATETIME NOT NULL,
				expires DATETIME NOT NULL,
				seats INT NOT NULL DEFAULT 5,
				order_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
				notified VARCHAR(64) NOT NULL DEFAULT '',
				created DATETIME NOT NULL,
				PRIMARY KEY  (id),
				KEY company_id (company_id),
				KEY order_id (order_id)
			) {$charset};"
		);
		update_option( 'oxe_schema_version', self::SCHEMA_VERSION );
	}
}
