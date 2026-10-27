<?php
/**
 * Staging only: send every email to the Mailpit catcher, never to real inboxes.
 */
add_action(
	'phpmailer_init',
	function ( $mailer ) {
		$mailer->isSMTP();
		$mailer->Host          = 'mailpit';
		$mailer->Port          = 1025;
		$mailer->SMTPAuth      = false;
		$mailer->SMTPAutoTLS   = false;
	}
);
add_filter( 'wp_mail_from', function () {
	return 'staging@ohjiya.sa';
} );
