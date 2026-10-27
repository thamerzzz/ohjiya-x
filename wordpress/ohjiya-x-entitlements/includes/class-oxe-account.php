<?php
/**
 * "Ohjiya X" tab in WooCommerce My Account: plan, members, invitations.
 *
 * @package OhjiyaX
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OXE_Account {

	const ENDPOINT = 'ohjiya-x';

	public static function init() {
		add_action( 'init', array( __CLASS__, 'add_endpoint' ) );
		add_action( 'init', array( __CLASS__, 'ensure_page' ) );
		add_shortcode( 'ohjiya_x_account', array( __CLASS__, 'shortcode' ) );
		add_filter( 'query_vars', array( __CLASS__, 'query_vars' ) );
		add_filter( 'woocommerce_account_menu_items', array( __CLASS__, 'menu' ) );
		add_action( 'woocommerce_account_' . self::ENDPOINT . '_endpoint', array( __CLASS__, 'render' ) );
		add_action( 'admin_post_oxe_invite', array( __CLASS__, 'handle_invite' ) );
		add_action( 'admin_post_oxe_remove', array( __CLASS__, 'handle_remove' ) );
		add_action( 'user_register', array( __CLASS__, 'claim_invites_by_id' ) );
		add_action( 'wp_login', array( __CLASS__, 'claim_invites_on_login' ), 10, 2 );
	}

	const PAGE_OPTION = 'oxe_account_page_id';

	/**
	 * Own page with [ohjiya_x_account]. The WooCommerce My Account page can live
	 * under another plugin (BuddyBoss puts it at /members/<user>/shop/), so the app
	 * links here instead of to a My Account endpoint.
	 */
	public static function ensure_page() {
		$id = (int) get_option( self::PAGE_OPTION );
		if ( $id && 'publish' === get_post_status( $id ) ) {
			return;
		}
		$id = wp_insert_post(
			array(
				'post_type'    => 'page',
				'post_status'  => 'publish',
				'post_title'   => OXE_Util::t( 'Ohjiya X', 'أحجية X' ),
				'post_name'    => 'ohjiya-x',
				'post_content' => '[ohjiya_x_account]',
			)
		);
		if ( $id && ! is_wp_error( $id ) ) {
			update_option( self::PAGE_OPTION, (int) $id, false );
		}
	}

	public static function account_url() {
		$id = (int) get_option( self::PAGE_OPTION );
		$url = $id ? get_permalink( $id ) : '';
		return $url ? $url : home_url( '/ohjiya-x/' );
	}

	public static function shortcode() {
		if ( ! is_user_logged_in() ) {
			return '<p><a href="' . esc_url( wp_login_url( self::account_url() ) ) . '">' . esc_html( OXE_Util::t( 'Sign in to see your Ohjiya X plan', 'سجّل الدخول لعرض اشتراكك في أحجية X' ) ) . '</a></p>';
		}
		ob_start();
		self::render();
		return ob_get_clean();
	}

	public static function add_endpoint() {
		add_rewrite_endpoint( self::ENDPOINT, EP_ROOT | EP_PAGES );
	}

	public static function query_vars( $vars ) {
		$vars[] = self::ENDPOINT;
		return $vars;
	}

	public static function menu( $items ) {
		$items[ self::ENDPOINT ] = OXE_Util::t( 'Ohjiya X', 'أحجية X' );
		return $items;
	}

	/** Company the user manages (owner or admin), or 0. */
	private static function managed_company( $user_id ) {
		foreach ( OXE_Plans::company_ids_for_user( $user_id ) as $company_id ) {
			if ( in_array( OXE_Plans::role( $company_id, $user_id ), array( 'owner', 'admin' ), true ) ) {
				return $company_id;
			}
		}
		return 0;
	}

	public static function render() {
		$user_id = get_current_user_id();
		$doc     = OXE_Plans::entitlement_for_user( $user_id );
		$app     = defined( 'OXE_APP_URL' ) ? esc_url( OXE_APP_URL ) : '#';

		if ( ! $doc['company'] ) {
			echo '<p>' . esc_html( OXE_Util::t( 'You do not belong to an Ohjiya X company yet. Buy a plan, or ask your company owner to invite you.', 'لست عضوًا في أي شركة على أحجية X بعد. اشترِ اشتراكًا أو اطلب من مالك الشركة دعوتك.' ) ) . '</p>';
			return;
		}

		$plan = $doc['plan'];
		echo '<h3>' . esc_html( $doc['company']['name'] ) . '</h3>';
		echo '<p>' . esc_html( OXE_Util::t( 'Edition', 'الإصدار' ) ) . ': <strong>' . esc_html( $plan['edition'] ? OXE_Util::edition_label( $plan['edition'] ) : '-' ) . '</strong><br>';
		echo esc_html( OXE_Util::t( 'Status', 'الحالة' ) ) . ': <strong>' . esc_html( $plan['status'] ) . '</strong><br>';
		echo esc_html( OXE_Util::t( 'Valid until', 'صالح حتى' ) ) . ': <strong>' . esc_html( (string) $plan['expires'] ) . '</strong></p>';
		echo '<p><a class="button" href="' . $app . '">' . esc_html( OXE_Util::t( 'Open Ohjiya X', 'افتح أحجية X' ) ) . '</a></p>'; // phpcs:ignore WordPress.Security.EscapeOutput

		$company_id = self::managed_company( $user_id );
		if ( ! $company_id ) {
			return;
		}

		$members = OXE_Plans::members( $company_id );
		$used    = count( $members );
		echo '<h4>' . esc_html( OXE_Util::t( 'Team', 'الفريق' ) ) . ' (' . (int) $used . ' / ' . (int) $plan['seats'] . ')</h4><ul>';
		foreach ( $members as $m ) {
			$label = (int) $m['user_id'] ? ( get_userdata( (int) $m['user_id'] ) ? get_userdata( (int) $m['user_id'] )->user_email : '#' . (int) $m['user_id'] ) : $m['invite_email'] . ' (' . OXE_Util::t( 'invited', 'مدعو' ) . ')';
			echo '<li>' . esc_html( $label ) . ' - ' . esc_html( $m['role'] );
			if ( 'owner' !== $m['role'] ) {
				$url = wp_nonce_url( admin_url( 'admin-post.php?action=oxe_remove&member=' . (int) $m['id'] ), 'oxe_remove_' . (int) $m['id'] );
				echo ' <a href="' . esc_url( $url ) . '">' . esc_html( OXE_Util::t( 'remove', 'إزالة' ) ) . '</a>';
			}
			echo '</li>';
		}
		echo '</ul>';

		if ( $used < (int) $plan['seats'] ) {
			echo '<form method="post" action="' . esc_url( admin_url( 'admin-post.php' ) ) . '">';
			echo '<input type="hidden" name="action" value="oxe_invite">';
			wp_nonce_field( 'oxe_invite' );
			echo '<input type="email" name="email" required placeholder="' . esc_attr( OXE_Util::t( 'Colleague email', 'بريد الزميل' ) ) . '"> ';
			echo '<button type="submit" class="button">' . esc_html( OXE_Util::t( 'Invite', 'دعوة' ) ) . '</button></form>';
		}
	}

	public static function handle_invite() {
		check_admin_referer( 'oxe_invite' );
		$user_id    = get_current_user_id();
		$company_id = $user_id ? self::managed_company( $user_id ) : 0;
		$email      = isset( $_POST['email'] ) ? sanitize_email( wp_unslash( $_POST['email'] ) ) : '';
		if ( ! $company_id || ! is_email( $email ) ) {
			wp_safe_redirect( self::account_url() );
			exit;
		}

		$eff   = OXE_Plans::effective( $company_id );
		$count = count( OXE_Plans::members( $company_id ) );
		if ( 'active' === $eff['status'] && $count < $eff['seats'] ) {
			$existing = get_user_by( 'email', $email );
			if ( $existing && ! OXE_Plans::role( $company_id, (int) $existing->ID ) ) {
				OXE_Plans::add_member( $company_id, (int) $existing->ID );
			} elseif ( ! $existing ) {
				OXE_Plans::add_member( $company_id, 0, 'member', strtolower( $email ) );
				wp_mail(
					$email,
					OXE_Util::t( 'You have been invited to Ohjiya X', 'تمت دعوتك إلى أحجية X' ),
					OXE_Util::t( 'Create your free account on ohjiya.sa with this email address and you will join the team automatically: ', 'أنشئ حسابك المجاني على ohjiya.sa بهذا البريد وستنضم إلى الفريق تلقائيًا: ' ) . home_url( '/' )
				);
			}
		}
		wp_safe_redirect( self::account_url() );
		exit;
	}

	public static function handle_remove() {
		global $wpdb;
		$member_id = isset( $_GET['member'] ) ? absint( $_GET['member'] ) : 0;
		check_admin_referer( 'oxe_remove_' . $member_id );
		$t   = OXE_DB::table( 'member' );
		$row = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$t} WHERE id = %d", $member_id ), ARRAY_A );

		if ( $row && 'owner' !== $row['role'] && self::managed_company( get_current_user_id() ) === (int) $row['company_id'] ) {
			$wpdb->delete( $t, array( 'id' => $member_id ) );
			OXE_Plans::changed( array( (int) $row['user_id'] ) );
		}
		wp_safe_redirect( self::account_url() );
		exit;
	}

	public static function claim_invites_by_id( $user_id ) {
		$user = get_userdata( $user_id );
		if ( $user ) {
			self::claim_invites( $user );
		}
	}

	public static function claim_invites_on_login( $login, $user ) {
		self::claim_invites( $user );
	}

	/** Turn pending email invitations into memberships once the account exists. */
	private static function claim_invites( WP_User $user ) {
		global $wpdb;
		$t = OXE_DB::table( 'member' );
		$n = $wpdb->query( $wpdb->prepare( "UPDATE {$t} SET user_id = %d, invite_email = '' WHERE user_id = 0 AND invite_email = %s", $user->ID, strtolower( $user->user_email ) ) );
		if ( $n ) {
			OXE_Plans::changed( array( (int) $user->ID ) );
		}
	}
}
