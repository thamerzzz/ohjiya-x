<?php
/**
 * Small shared helpers.
 *
 * @package OhjiyaX
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OXE_Util {

	/** Editions sold. Keys are stable ids used by the app. */
	const EDITIONS = array(
		'retail'           => array( 'Retail', 'التجزئة' ),
		'digital_business' => array( 'Digital Business', 'الأعمال الرقمية' ),
		'real_estate'      => array( 'Real Estate', 'العقارات' ),
	);

	/** Current UTC time as a MySQL datetime string. */
	public static function now() {
		return gmdate( 'Y-m-d H:i:s' );
	}

	/** Add a period to a UTC datetime string, e.g. '+1 year'. */
	public static function add( $datetime, $modifier ) {
		$dt = new DateTime( $datetime, new DateTimeZone( 'UTC' ) );
		$dt->modify( $modifier );
		return $dt->format( 'Y-m-d H:i:s' );
	}

	/** English or Arabic text depending on a locale (defaults to the site locale). */
	public static function t( $en, $ar, $locale = '' ) {
		$locale = $locale ? $locale : determine_locale();
		return 0 === strpos( $locale, 'ar' ) ? $ar : $en;
	}

	public static function edition_label( $edition, $locale = '' ) {
		if ( ! isset( self::EDITIONS[ $edition ] ) ) {
			return $edition;
		}
		return self::t( self::EDITIONS[ $edition ][0], self::EDITIONS[ $edition ][1], $locale );
	}

	public static function b64url_encode( $data ) {
		return rtrim( strtr( base64_encode( $data ), '+/', '-_' ), '=' );
	}

	public static function b64url_decode( $data ) {
		$remainder = strlen( $data ) % 4;
		if ( $remainder ) {
			$data .= str_repeat( '=', 4 - $remainder );
		}
		return base64_decode( strtr( $data, '-_', '+/' ), true );
	}

	/** A secret defined in wp-config.php, or '' when missing or too short. */
	public static function secret( $constant ) {
		$value = defined( $constant ) ? (string) constant( $constant ) : '';
		return strlen( $value ) >= 32 ? $value : '';
	}

	/** Host of the Ohjiya X app, lowercase, or ''. */
	public static function app_host() {
		$url = defined( 'OXE_APP_URL' ) ? (string) OXE_APP_URL : '';
		return strtolower( (string) wp_parse_url( $url, PHP_URL_HOST ) );
	}
}
