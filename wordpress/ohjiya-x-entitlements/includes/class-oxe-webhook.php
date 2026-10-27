<?php
/**
 * Tells the app an entitlement changed so it can drop its cache at once.
 *
 * Signature header: HMAC-SHA256 over "{timestamp}.{body}" with OXE_WEBHOOK_SECRET.
 * Fire-and-forget: if the app is down it still expires its cache within 10 minutes.
 *
 * @package OhjiyaX
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OXE_Webhook {

	public static function send( array $user_ids ) {
		$secret = OXE_Util::secret( 'OXE_WEBHOOK_SECRET' );
		$app    = defined( 'OXE_APP_URL' ) ? untrailingslashit( (string) OXE_APP_URL ) : '';
		if ( '' === $secret || '' === $app ) {
			return;
		}
		$body = wp_json_encode(
			array(
				'user_ids' => $user_ids,
				'version'  => (int) get_option( 'oxe_version', 1 ),
			)
		);
		$ts   = (string) time();
		wp_remote_post(
			$app . '/api/hooks/entitlement',
			array(
				'timeout'  => 5,
				'blocking' => false,
				'headers'  => array(
					'Content-Type'    => 'application/json',
					'X-OXE-Timestamp' => $ts,
					'X-OXE-Signature' => hash_hmac( 'sha256', $ts . '.' . $body, $secret ),
				),
				'body'     => $body,
			)
		);
	}
}
