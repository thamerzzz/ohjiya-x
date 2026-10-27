<?php
/**
 * Sign-in handshake for the Ohjiya X app.
 *
 *   x.ohjiya.sa/auth/start  (sets a state cookie, redirects here)
 *     -> ohjiya.sa/?oxe_sso=issue&return=<x consume url>&state=<state>
 *     -> WordPress login if needed
 *     -> redirect to <return>?oxe_token=<token>&state=<state>
 *
 * The return host must be the configured app host; a token is never minted for
 * any other destination.
 *
 * @package OhjiyaX
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OXE_SSO {

	public static function init() {
		add_action( 'init', array( __CLASS__, 'maybe_handle' ) );
	}

	public static function maybe_handle() {
		if ( ! isset( $_GET['oxe_sso'] ) || 'issue' !== sanitize_key( wp_unslash( $_GET['oxe_sso'] ) ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended
			return;
		}

		$secret   = OXE_Util::secret( 'OXE_SSO_SECRET' );
		$app_host = OXE_Util::app_host();
		if ( '' === $secret || '' === $app_host ) {
			wp_die( esc_html__( 'Ohjiya X sign-in is not configured.', 'ohjiya-x-entitlements' ), 500 );
		}

		$return = isset( $_GET['return'] ) ? esc_url_raw( rawurldecode( wp_unslash( $_GET['return'] ) ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		$state  = isset( $_GET['state'] ) ? sanitize_text_field( rawurldecode( wp_unslash( $_GET['state'] ) ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		$parts  = wp_parse_url( $return );

		if ( empty( $parts['host'] ) || strtolower( $parts['host'] ) !== $app_host || ( $parts['scheme'] ?? '' ) !== 'https' ) {
			wp_die( esc_html__( 'Return address is not allowed.', 'ohjiya-x-entitlements' ), 403 );
		}
		if ( strlen( $state ) < 16 || strlen( $state ) > 128 ) {
			wp_die( esc_html__( 'Missing sign-in state.', 'ohjiya-x-entitlements' ), 400 );
		}

		if ( ! is_user_logged_in() ) {
			$come_back = add_query_arg(
				array(
					'oxe_sso' => 'issue',
					'return'  => rawurlencode( $return ),
					'state'   => rawurlencode( $state ),
				),
				home_url( '/' )
			);
			wp_safe_redirect( wp_login_url( $come_back ) );
			exit;
		}

		$user  = wp_get_current_user();
		$token = OXE_Token::create(
			array(
				'user_id' => (int) $user->ID,
				'email'   => $user->user_email,
				'name'    => $user->display_name,
				'locale'  => get_user_locale( $user ),
				'state'   => $state,
			),
			$secret,
			$app_host
		);

		wp_redirect( add_query_arg( array( 'oxe_token' => rawurlencode( $token ), 'state' => rawurlencode( $state ) ), $return ) ); // phpcs:ignore WordPress.Security.SafeRedirect.wp_redirect_wp_redirect -- host checked above.
		exit;
	}
}
