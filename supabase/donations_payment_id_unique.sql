-- Optional: idempotent PayPal donations (one row per PayPal order id)
create unique index if not exists donations_payment_id_unique on public.donations (payment_id);
