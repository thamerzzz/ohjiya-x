<?php
/**
 * Entitlement API, called server to server by the app.
 *
 *   GET /wp-json/ohjiya-x/v1/entitlement?user=<wp user id>
 *   X-OXE-Timestamp: <unix seconds, within 60 s>
 *   X-OXE-Signature: hex HMAC-SHA256 over "{timestamp}.{user id}" with OXE_API_SECRET
 *
 * @package OhjiyaX
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OXE_API {

	const WINDOW = 60;

	public static function init() {
		add_action( 'rest_api_init', array( __CLASS__, 'routes' ) );
	}

	public static function routes() {
		register_rest_route(
			'ohjiya-x/v1',
			'/entitlement',
			array(
				'methods'             => 'GET',
				'callback'            => array( __CLASS__, 'entitlement' ),
				'permission_callback' => array( __CLASS__, 'authorize' ),
				'args'                => array(
					'user' => array(
						'required'          => true,
						'sanitize_callback' => 'absint',
					),
				),
			)
		);
	}

	public static function authorize( WP_REST_Request $request ) {
		$secret = OXE_Util::secret( 'OXE_API_SECRET' );
		if ( '' === $secret ) {
			return new WP_Error( 'oxe_not_configured', 'Not configured.', array( 'status' => 500 ) );
		}
		$ts   = (string) $request->get_header( 'x-oxe-timestamp' );
		$sig  = (string) $request->get_header( 'x-oxe-signature' );
		$user = (string) absint( $request->get_param( 'user' ) );

		if ( ! ctype_digit( $ts ) || abs( time() - (int) $ts ) > self::WINDOW ) {
			return new WP_Error( 'oxe_stale', 'Stale or missing timestamp.', array( 'status' => 401 ) );
		}
		$expected = hash_hmac( 'sha256', $ts . '.' . $user, $secret );
		if ( '' === $sig || ! hash_equals( $expected, $sig ) ) {
			return new WP_Error( 'oxe_bad_signature', 'Bad signature.', array( 'status' => 401 ) );
		}
		return true;
	}

	public static function entitlement( WP_REST_Request $request ) {
		$user_id = absint( $request->get_param( 'user' ) );
		if ( ! $user_id || ! get_userdata( $user_id ) ) {
			return new WP_Error( 'oxe_no_user', 'Unknown user.', array( 'status' => 404 ) );
		}
		$response = new WP_REST_Response( OXE_Plans::entitlement_for_user( $user_id ) );
		$response->header( 'Cache-Control', 'no-store' );
		return $response;
	}
}
