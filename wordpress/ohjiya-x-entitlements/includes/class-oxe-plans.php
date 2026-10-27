<?php
/**
 * Companies, members and plan ledger.
 *
 * Every purchase or manual extension is one row in oxe_plan. A company's
 * state is derived from its non-revoked rows, so a refund only revokes the
 * row it created.
 *
 * @package OhjiyaX
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OXE_Plans {

	const RANK = array(
		'active' => 3,
		'grace'  => 2,
		'expired' => 1,
		'none'   => 0,
	);

	/* ---------------- companies and members ---------------- */

	public static function create_company( $name, $owner_user_id ) {
		global $wpdb;
		$wpdb->insert(
			OXE_DB::table( 'company' ),
			array(
				'name'          => mb_substr( $name, 0, 190 ),
				'owner_user_id' => (int) $owner_user_id,
				'created'       => OXE_Util::now(),
			)
		);
		$company_id = (int) $wpdb->insert_id;
		self::add_member( $company_id, (int) $owner_user_id, 'owner' );
		return $company_id;
	}

	public static function add_member( $company_id, $user_id, $role = 'member', $invite_email = '' ) {
		global $wpdb;
		$wpdb->insert(
			OXE_DB::table( 'member' ),
			array(
				'company_id'   => (int) $company_id,
				'user_id'      => (int) $user_id,
				'invite_email' => $invite_email,
				'role'         => $role,
				'created'      => OXE_Util::now(),
			)
		);
		self::changed( array( (int) $user_id ) );
	}

	public static function owned_company_id( $user_id ) {
		global $wpdb;
		$t = OXE_DB::table( 'company' );
		return (int) $wpdb->get_var( $wpdb->prepare( "SELECT id FROM {$t} WHERE owner_user_id = %d ORDER BY id ASC LIMIT 1", $user_id ) );
	}

	/** Role of a user in a company, or ''. */
	public static function role( $company_id, $user_id ) {
		global $wpdb;
		$t = OXE_DB::table( 'member' );
		return (string) $wpdb->get_var( $wpdb->prepare( "SELECT role FROM {$t} WHERE company_id = %d AND user_id = %d LIMIT 1", $company_id, $user_id ) );
	}

	public static function members( $company_id ) {
		global $wpdb;
		$t = OXE_DB::table( 'member' );
		return $wpdb->get_results( $wpdb->prepare( "SELECT * FROM {$t} WHERE company_id = %d ORDER BY id ASC", $company_id ), ARRAY_A );
	}

	public static function member_user_ids( $company_id ) {
		return array_values( array_filter( array_map( 'intval', wp_list_pluck( self::members( $company_id ), 'user_id' ) ) ) );
	}

	public static function company( $company_id ) {
		global $wpdb;
		$t = OXE_DB::table( 'company' );
		return $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$t} WHERE id = %d", $company_id ), ARRAY_A );
	}

	/** Companies a user belongs to (any role). */
	public static function company_ids_for_user( $user_id ) {
		global $wpdb;
		$t = OXE_DB::table( 'member' );
		return array_map( 'intval', $wpdb->get_col( $wpdb->prepare( "SELECT DISTINCT company_id FROM {$t} WHERE user_id = %d", $user_id ) ) );
	}

	/* ---------------- plan ledger ---------------- */

	public static function plan_rows( $company_id ) {
		global $wpdb;
		$t = OXE_DB::table( 'plan' );
		return $wpdb->get_results( $wpdb->prepare( "SELECT * FROM {$t} WHERE company_id = %d AND status <> 'revoked' ORDER BY expires DESC, id DESC", $company_id ), ARRAY_A );
	}

	/**
	 * Add a plan period. It starts when the current one ends (or now), so
	 * renewing early never wastes paid time.
	 *
	 * @return int Plan row id.
	 */
	public static function add_period( $company_id, $edition, $modifier, $seats, $order_id = 0 ) {
		global $wpdb;
		$now    = OXE_Util::now();
		$rows   = self::plan_rows( $company_id );
		$latest = $rows ? $rows[0]['expires'] : $now;
		$starts = $latest > $now ? $latest : $now;

		$wpdb->insert(
			OXE_DB::table( 'plan' ),
			array(
				'company_id' => (int) $company_id,
				'edition'    => $edition,
				'status'     => 'active',
				'starts'     => $starts,
				'expires'    => OXE_Util::add( $starts, $modifier ),
				'seats'      => max( 1, (int) $seats ),
				'order_id'   => (int) $order_id,
				'created'    => $now,
			)
		);
		$id = (int) $wpdb->insert_id;
		self::changed( self::member_user_ids( $company_id ) );
		return $id;
	}

	public static function revoke_order( $order_id ) {
		global $wpdb;
		$plan = OXE_DB::table( 'plan' );
		$ids  = $wpdb->get_col( $wpdb->prepare( "SELECT DISTINCT company_id FROM {$plan} WHERE order_id = %d", $order_id ) );
		$wpdb->update( $plan, array( 'status' => 'revoked' ), array( 'order_id' => (int) $order_id ) );
		foreach ( $ids as $company_id ) {
			self::changed( self::member_user_ids( (int) $company_id ) );
		}
	}

	public static function revoke_row( $plan_id ) {
		global $wpdb;
		$plan       = OXE_DB::table( 'plan' );
		$company_id = (int) $wpdb->get_var( $wpdb->prepare( "SELECT company_id FROM {$plan} WHERE id = %d", $plan_id ) );
		$wpdb->update( $plan, array( 'status' => 'revoked' ), array( 'id' => (int) $plan_id ) );
		if ( $company_id ) {
			self::changed( self::member_user_ids( $company_id ) );
		}
	}

	/**
	 * Derived state for a company at a moment in time.
	 *
	 * @return array status (active|grace|expired|none), edition, expires, seats.
	 */
	public static function effective( $company_id, $now = '' ) {
		$now  = $now ? $now : OXE_Util::now();
		$rows = self::plan_rows( $company_id );
		if ( ! $rows ) {
			return array( 'status' => 'none', 'edition' => '', 'expires' => '', 'seats' => 0 );
		}
		foreach ( $rows as $row ) { // Newest expiry first.
			if ( $row['starts'] <= $now && $now < $row['expires'] ) {
				return array( 'status' => 'active', 'edition' => $row['edition'], 'expires' => $rows[0]['expires'], 'seats' => (int) $row['seats'] );
			}
		}
		$last = $rows[0];
		$over = OXE_Util::add( $last['expires'], '+' . OXE_GRACE_DAYS . ' days' );
		return array(
			'status'  => $now < $over ? 'grace' : 'expired',
			'edition' => $last['edition'],
			'expires' => $last['expires'],
			'seats'   => (int) $last['seats'],
		);
	}

	/** Features a plan state unlocks. Grace and expired plans unlock nothing. */
	public static function features( $edition, $status ) {
		if ( 'active' !== $status ) {
			return array();
		}
		$features = array( 'voice', 'chat', 'connectors', 'rss' );
		if ( in_array( $edition, array( 'retail', 'real_estate' ), true ) ) {
			$features[] = 'hex_layers';
		}
		return apply_filters( 'oxe_features', $features, $edition );
	}

	/** The entitlement document the app reads for a WordPress user. */
	public static function entitlement_for_user( $user_id ) {
		$best = null;
		foreach ( self::company_ids_for_user( $user_id ) as $company_id ) {
			$eff = self::effective( $company_id );
			if ( null === $best
				|| self::RANK[ $eff['status'] ] > self::RANK[ $best['eff']['status'] ]
				|| ( self::RANK[ $eff['status'] ] === self::RANK[ $best['eff']['status'] ] && $eff['expires'] > $best['eff']['expires'] ) ) {
				$best = array( 'company_id' => $company_id, 'eff' => $eff );
			}
		}

		$doc = array(
			'user_id'  => (int) $user_id,
			'company'  => null,
			'plan'     => array( 'edition' => null, 'status' => 'none', 'expires' => null, 'seats' => 0 ),
			'features' => array(),
			'version'  => (int) get_option( 'oxe_version', 1 ),
			'account_url' => OXE_Account::account_url(),
		);
		if ( ! $best ) {
			return $doc;
		}

		$company        = self::company( $best['company_id'] );
		$eff            = $best['eff'];
		$doc['company'] = array(
			'id'   => (int) $company['id'],
			'name' => $company['name'],
			'role' => self::role( $best['company_id'], $user_id ),
		);
		$doc['plan']    = array(
			'edition' => $eff['edition'] ? $eff['edition'] : null,
			'status'  => $eff['status'],
			'expires' => $eff['expires'] ? gmdate( 'Y-m-d', strtotime( $eff['expires'] . ' UTC' ) ) : null,
			'seats'   => $eff['seats'],
		);
		$doc['features'] = self::features( $eff['edition'], $eff['status'] );
		return $doc;
	}

	/** Bump the version and tell the app these users' entitlements changed. */
	public static function changed( array $user_ids ) {
		update_option( 'oxe_version', (int) get_option( 'oxe_version', 1 ) + 1, false );
		$user_ids = array_values( array_unique( array_filter( array_map( 'intval', $user_ids ) ) ) );
		if ( $user_ids ) {
			OXE_Webhook::send( $user_ids );
		}
	}
}
