<?php
/**
 * Admin screen: WooCommerce > Ohjiya X plans. Lists companies and lets a shop
 * manager add time or revoke a plan period (for gifts, trials and support).
 *
 * @package OhjiyaX
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OXE_Admin {

	const CAP = 'manage_woocommerce';

	public static function init() {
		add_action( 'admin_menu', array( __CLASS__, 'menu' ) );
		add_action( 'admin_post_oxe_admin_extend', array( __CLASS__, 'handle_extend' ) );
		add_action( 'admin_post_oxe_admin_revoke', array( __CLASS__, 'handle_revoke' ) );
	}

	public static function menu() {
		add_submenu_page( 'woocommerce', 'Ohjiya X plans', 'Ohjiya X plans', self::CAP, 'oxe-plans', array( __CLASS__, 'render' ) );
	}

	public static function render() {
		if ( ! current_user_can( self::CAP ) ) {
			return;
		}
		global $wpdb;
		$companies = $wpdb->get_results( 'SELECT * FROM ' . OXE_DB::table( 'company' ) . ' ORDER BY id DESC LIMIT 200', ARRAY_A ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared

		echo '<div class="wrap"><h1>Ohjiya X plans</h1>';
		echo '<table class="widefat striped"><thead><tr><th>Company</th><th>Owner</th><th>Edition</th><th>Status</th><th>Expires (UTC)</th><th>Seats</th><th>Actions</th></tr></thead><tbody>';
		foreach ( $companies as $c ) {
			$eff   = OXE_Plans::effective( (int) $c['id'] );
			$owner = get_userdata( (int) $c['owner_user_id'] );
			$rows  = OXE_Plans::plan_rows( (int) $c['id'] );
			echo '<tr><td>' . esc_html( $c['name'] ) . ' (#' . (int) $c['id'] . ')</td>';
			echo '<td>' . esc_html( $owner ? $owner->user_email : '-' ) . '</td>';
			echo '<td>' . esc_html( $eff['edition'] ? $eff['edition'] : '-' ) . '</td>';
			echo '<td>' . esc_html( $eff['status'] ) . '</td>';
			echo '<td>' . esc_html( $eff['expires'] ? $eff['expires'] : '-' ) . '</td>';
			echo '<td>' . count( OXE_Plans::members( (int) $c['id'] ) ) . ' / ' . (int) $eff['seats'] . '</td><td>';

			echo '<form method="post" action="' . esc_url( admin_url( 'admin-post.php' ) ) . '" style="display:inline">';
			echo '<input type="hidden" name="action" value="oxe_admin_extend"><input type="hidden" name="company" value="' . (int) $c['id'] . '">';
			wp_nonce_field( 'oxe_admin_extend_' . (int) $c['id'] );
			echo '<select name="edition">';
			foreach ( OXE_Util::EDITIONS as $key => $labels ) {
				echo '<option value="' . esc_attr( $key ) . '"' . selected( $eff['edition'], $key, false ) . '>' . esc_html( $labels[0] ) . '</option>';
			}
			echo '</select> <input type="number" name="months" value="12" min="1" max="36" style="width:60px"> mo ';
			echo '<button class="button">Add time</button></form> ';

			if ( $rows ) {
				$url = wp_nonce_url( admin_url( 'admin-post.php?action=oxe_admin_revoke&plan=' . (int) $rows[0]['id'] ), 'oxe_admin_revoke_' . (int) $rows[0]['id'] );
				echo '<a class="button" href="' . esc_url( $url ) . '" onclick="return confirm(\'Revoke the latest plan period?\')">Revoke latest</a>';
			}
			echo '</td></tr>';
		}
		echo '</tbody></table></div>';
	}

	public static function handle_extend() {
		$company_id = isset( $_POST['company'] ) ? absint( $_POST['company'] ) : 0;
		check_admin_referer( 'oxe_admin_extend_' . $company_id );
		if ( ! current_user_can( self::CAP ) ) {
			wp_die( 'Forbidden', 403 );
		}
		$edition = isset( $_POST['edition'] ) ? sanitize_key( wp_unslash( $_POST['edition'] ) ) : '';
		$months  = isset( $_POST['months'] ) ? min( 36, max( 1, absint( $_POST['months'] ) ) ) : 12;
		if ( $company_id && OXE_Plans::company( $company_id ) && isset( OXE_Util::EDITIONS[ $edition ] ) ) {
			$eff = OXE_Plans::effective( $company_id );
			OXE_Plans::add_period( $company_id, $edition, '+' . $months . ' months', $eff['seats'] ? $eff['seats'] : 5, 0 );
		}
		wp_safe_redirect( admin_url( 'admin.php?page=oxe-plans' ) );
		exit;
	}

	public static function handle_revoke() {
		$plan_id = isset( $_GET['plan'] ) ? absint( $_GET['plan'] ) : 0;
		check_admin_referer( 'oxe_admin_revoke_' . $plan_id );
		if ( ! current_user_can( self::CAP ) ) {
			wp_die( 'Forbidden', 403 );
		}
		if ( $plan_id ) {
			OXE_Plans::revoke_row( $plan_id );
		}
		wp_safe_redirect( admin_url( 'admin.php?page=oxe-plans' ) );
		exit;
	}
}
