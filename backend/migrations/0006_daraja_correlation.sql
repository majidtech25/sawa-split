-- Daraja's STK callback payload carries no passthrough field back to our own
-- transaction id — only CheckoutRequestID, which we get back from the original STK
-- push response. Store it at initiate time so the callback (CLAUDE.md section 6
-- step 2) can find the right row.
alter table transactions add column checkout_request_id text unique;

-- B2C's ResultURL callback DOES echo back OriginatorConversationID, which we set to
-- withdrawal_requests.idempotency_key at request time — no new column needed there,
-- just noting it here since it's the correlation key for section 6 step 5.
