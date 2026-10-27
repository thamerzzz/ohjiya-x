<?php
/**
 * Daily check: renewal reminders and expiry notices.
 *
 * Paymob here has no automatic yearly billing, so renewal is manual. The owner
 * is emailed at 30, 14 and 3 days before the plan ends and when it ends; each
 * milestone is sent once (tracked on the company's latest plan row).
 *
 * @package OhjiyaX
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OXE_Renewals {

	const HOOK       = 'oxe_daily_check';
	const MILESTONES = array( 30, 14, 3, 0 );

	public static function init() {
		add_action( self::HOOK, array( __CLASS__, 'run' ) );
		if ( ! wp_next_scheduled( self::HOOK ) ) {
			self::schedule();
		}
	}

	public static function schedule() {
		if ( ! wp_next_scheduled( self::HOOK ) ) {
			wp_schedule_event( time() + HOUR_IN_SECONDS, 'daily', self::HOOK );
		}
	}

	public static function deactivate() {
		wp_clear_scheduled_hook( self::HOOK );
	}

	public static function run() {
		global $wpdb;
		$companies = $wpdb->get_col( 'SELECT id FROM ' . OXE_DB::table( 'company' ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		$now       = OXE_Util::now();

		foreach ( $companies as $company_id ) {
			$company_id = (int) $company_id;
			$rows       = OXE_Plans::plan_rows( $company_id );
			if ( ! $rows ) {
				continue;
			}
			$latest    = $rows[0];
			$days_left = (int) floor( ( strtotime( $latest['expires'] . ' UTC' ) - strtotime( $now . ' UTC' ) ) / DAY_IN_SECONDS );
			$sent      = array_filter( explode( ',', (string) $latest['notified'] ) );

			// Milestones already reached, smallest last. Only the nearest one is
			// emailed; the larger ones are marked sent so a plan first seen at 10
			// days left gets one "14 days" notice, not 30 then 14 then 3.
			$reached = array_values( array_filter( self::MILESTONES, function ( $m ) use ( $days_left ) {
				return $days_left <= $m;
			} ) );
			if ( $reached ) {
				$nearest = min( $reached );
				if ( ! in_array( (string) $nearest, $sent, true ) ) {
					self::notify( $company_id, $latest, $nearest );
				}
				foreach ( $reached as $m ) {
					if ( ! in_array( (string) $m, $sent, true ) ) {
						$sent[] = (string) $m;
					}
				}
			}

			// End of grace: tell the app so the user drops to free immediately.
			$over = OXE_Util::add( $latest['expires'], '+' . OXE_GRACE_DAYS . ' days' );
			if ( $now >= $over && ! in_array( 'g', $sent, true ) ) {
				$sent[] = 'g';
				OXE_Plans::changed( OXE_Plans::member_user_ids( $company_id ) );
			}

			$wpdb->update( OXE_DB::table( 'plan' ), array( 'notified' => implode( ',', $sent ) ), array( 'id' => (int) $latest['id'] ) );
		}
	}

	private static function notify( $company_id, array $plan, $milestone ) {
		$company = OXE_Plans::company( $company_id );
		$owner   = $company ? get_userdata( (int) $company['owner_user_id'] ) : false;
		if ( ! $owner ) {
			return;
		}
		$locale  = get_user_locale( $owner );
		$edition = OXE_Util::edition_label( $plan['edition'], $locale );
		$date    = gmdate( 'Y-m-d', strtotime( $plan['expires'] . ' UTC' ) );
		$url     = OXE_Woo::renew_url( $plan['edition'] );

		if ( 0 === $milestone ) {
			$subject = OXE_Util::t( 'Your Ohjiya X plan has ended', 'انتهى اشتراكك في أحجية X', $locale );
			$line    = OXE_Util::t(
				"Your {$edition} plan ended on {$date}. You have " . OXE_GRACE_DAYS . ' days to renew before access returns to the free version.',
				"انتهى اشتراك {$edition} بتاريخ {$date}. لديك " . OXE_GRACE_DAYS . ' يومًا للتجديد قبل أن يعود الوصول إلى النسخة المجانية.',
				$locale
			);
		} else {
			$subject = OXE_Util::t( "Your Ohjiya X plan ends in {$milestone} days", "ينتهي اشتراكك في أحجية X بعد {$milestone} يومًا", $locale );
			$line    = OXE_Util::t(
				"Your {$edition} plan ends on {$date}. Renew now and the new year starts when this one ends, so no time is lost.",
				"ينتهي اشتراك {$edition} بتاريخ {$date}. جدّد الآن وتبدأ السنة الجديدة عند انتهاء الحالية دون خسارة أي وقت.",
				$locale
			);
		}
		$link = OXE_Util::t( 'Renew here: ', 'للتجديد: ', $locale ) . $url;

		wp_mail( $owner->user_email, $subject, $line . "\n\n" . $link . "\n\nOhjiya | أحجية" );

		if ( 0 === $milestone ) {
			OXE_Plans::changed( OXE_Plans::member_user_ids( $company_id ) );
		}
	}
}
