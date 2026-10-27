<?php
/**
 * Signed sign-in token for the Ohjiya X app.
 *
 * Same shape as the SSI plugin's tokens (base64url(json) . '.' . base64url(hmac))
 * but signed with its own secret, OXE_SSO_SECRET, so the app never holds the
 * secret that signs sign-ins for the other Ohjiya sites.
 *
 * @package OhjiyaX
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OXE_Token {

	const TTL = 120;

	public static function create( array $payload, $secret, $audience ) {
		$payload['iat'] = time();
		$payload['jti'] = wp_generate_password( 32, false );
		$payload['aud'] = $audience;
		$body           = OXE_Util::b64url_encode( wp_json_encode( $payload ) );
		$sig            = hash_hmac( 'sha256', $body, $secret, true );
		return $body . '.' . OXE_Util::b64url_encode( $sig );
	}
}
