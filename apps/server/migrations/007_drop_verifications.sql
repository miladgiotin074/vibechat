-- Identity verification (selfie + blue tick) was removed from the product.
-- The selfie files themselves live in object storage under verifications/ and are removed by
-- `npm run purge:verifications` (it deletes by prefix, so it works before or after this migration).
DROP TABLE IF EXISTS verifications;
