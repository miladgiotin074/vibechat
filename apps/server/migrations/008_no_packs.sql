-- The store sells memberships only: one-off packs of boosts / super likes are taken off sale.
-- Balances people already bought stay theirs and keep working.
UPDATE plans SET is_active = false WHERE kind <> 'premium';
