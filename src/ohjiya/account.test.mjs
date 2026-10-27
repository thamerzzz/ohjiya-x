import assert from 'node:assert/strict';
import test from 'node:test';
import { pickLanguage, planSummary } from './account.js';

test('language follows the WordPress locale, then the browser', () => {
  assert.equal(pickLanguage({ user: { locale: 'ar_SA' } }), 'ar');
  assert.equal(pickLanguage({ user: { locale: 'en_US' } }, 'ar'), 'en');
  assert.equal(pickLanguage(null, 'ar-SA'), 'ar');
  assert.equal(pickLanguage(null, ''), 'en');
});

test('the plan line says what is true now', () => {
  const me = (status, edition = 'real_estate') => ({ signedIn: true, plan: { status, edition, expires: '2027-01-01' } });
  assert.equal(planSummary({ signedIn: false }, 'en'), 'Free');
  assert.equal(planSummary(me('none'), 'en'), 'Free');
  assert.equal(planSummary(me('active'), 'en'), 'Real Estate until 2027-01-01');
  assert.match(planSummary(me('grace'), 'en'), /renew soon/);
  assert.match(planSummary(me('expired'), 'en'), /renew to restore/);
  assert.match(planSummary(me('active', 'retail'), 'ar'), /التجزئة/);
});
