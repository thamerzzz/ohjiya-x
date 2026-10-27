<?php
/**
 * WooCommerce side: edition products and order handling.
 *
 * A product with an edition set (Product data > General) is a plan. When its
 * order is paid, the buyer's company gets one year per unit. Refunds and
 * cancellations revoke only the periods that order created.
 *
 * @package OhjiyaX
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OXE_Woo {

	public static function init() {
		add_action( 'woocommerce_product_options_general_product_data', array( __CLASS__, 'product_fields' ) );
		add_action( 'woocommerce_process_product_meta', array( __CLASS__, 'save_product_fields' ) );
		add_action( 'woocommerce_order_status_processing', array( __CLASS__, 'apply_order' ) );
		add_action( 'woocommerce_order_status_completed', array( __CLASS__, 'apply_order' ) );
		add_action( 'woocommerce_order_status_refunded', array( __CLASS__, 'revoke_order' ) );
		add_action( 'woocommerce_order_status_cancelled', array( __CLASS__, 'revoke_order' ) );
		add_action( 'woocommerce_order_status_failed', array( __CLASS__, 'revoke_order' ) );
	}

	public static function product_fields() {
		echo '<div class="options_group">';
		$options = array( '' => __( 'Not an Ohjiya X plan', 'ohjiya-x-entitlements' ) );
		foreach ( OXE_Util::EDITIONS as $key => $labels ) {
			$options[ $key ] = $labels[0];
		}
		woocommerce_wp_select(
			array(
				'id'      => '_oxe_edition',
				'label'   => __( 'Ohjiya X edition', 'ohjiya-x-entitlements' ),
				'options' => $options,
			)
		);
		woocommerce_wp_text_input(
			array(
				'id'                => '_oxe_seats',
				'label'             => __( 'Seats per year', 'ohjiya-x-entitlements' ),
				'type'              => 'number',
				'custom_attributes' => array( 'min' => '1', 'step' => '1' ),
				'default'           => '5',
			)
		);
		echo '</div>';
	}

	public static function save_product_fields( $post_id ) {
		// WooCommerce verifies the product-save nonce before firing this hook.
		$edition = isset( $_POST['_oxe_edition'] ) ? sanitize_key( wp_unslash( $_POST['_oxe_edition'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Missing
		if ( '' !== $edition && ! isset( OXE_Util::EDITIONS[ $edition ] ) ) {
			$edition = '';
		}
		$seats = isset( $_POST['_oxe_seats'] ) ? max( 1, (int) $_POST['_oxe_seats'] ) : 5; // phpcs:ignore WordPress.Security.NonceVerification.Missing
		update_post_meta( $post_id, '_oxe_edition', $edition );
		update_post_meta( $post_id, '_oxe_seats', $seats );
	}

	/** Paid order -> add plan periods. Safe to run twice for the same order. */
	public static function apply_order( $order_id ) {
		$order = wc_get_order( $order_id );
		if ( ! $order || $order->get_meta( '_oxe_applied' ) ) {
			return;
		}

		$periods = array();
		foreach ( $order->get_items() as $item ) {
			$product_id = $item->get_product_id();
			$edition    = (string) get_post_meta( $product_id, '_oxe_edition', true );
			if ( '' === $edition || ! isset( OXE_Util::EDITIONS[ $edition ] ) ) {
				continue;
			}
			$seats = (int) get_post_meta( $product_id, '_oxe_seats', true );
			for ( $i = 0; $i < max( 1, (int) $item->get_quantity() ); $i++ ) {
				$periods[] = array( $edition, $seats > 0 ? $seats : 5 );
			}
		}
		if ( ! $periods ) {
			return;
		}

		$user_id = (int) $order->get_user_id();
		if ( ! $user_id ) {
			$order->add_order_note( 'Ohjiya X: guest checkout, no plan created. The buyer needs an account.' );
			return;
		}

		$company_id = OXE_Plans::owned_company_id( $user_id );
		if ( ! $company_id ) {
			$user       = get_userdata( $user_id );
			$name       = trim( (string) $order->get_billing_company() );
			$name       = '' !== $name ? $name : ( $user ? $user->display_name : 'Company ' . $user_id );
			$company_id = OXE_Plans::create_company( $name, $user_id );
		}

		foreach ( $periods as $period ) {
			OXE_Plans::add_period( $company_id, $period[0], '+1 year', $period[1], $order->get_id() );
		}
		$order->update_meta_data( '_oxe_applied', 1 );
		$order->add_order_note( sprintf( 'Ohjiya X: %d plan year(s) added to company #%d.', count( $periods ), $company_id ) );
		$order->save();
	}

	public static function revoke_order( $order_id ) {
		$order = wc_get_order( $order_id );
		if ( ! $order || ! $order->get_meta( '_oxe_applied' ) ) {
			return;
		}
		OXE_Plans::revoke_order( (int) $order_id );
		$order->delete_meta_data( '_oxe_applied' );
		$order->add_order_note( 'Ohjiya X: plan periods from this order were revoked.' );
		$order->save();
	}

	/** Add-to-cart link that renews an edition. */
	public static function renew_url( $edition ) {
		$ids = get_posts(
			array(
				'post_type'      => 'product',
				'post_status'    => 'publish',
				'fields'         => 'ids',
				'posts_per_page' => 1,
				'meta_key'       => '_oxe_edition', // phpcs:ignore WordPress.DB.SlowDBQuery
				'meta_value'     => $edition, // phpcs:ignore WordPress.DB.SlowDBQuery
			)
		);
		return $ids ? add_query_arg( 'add-to-cart', (int) $ids[0], wc_get_cart_url() ) : home_url( '/' );
	}
}
