-- Demo vendor refresh — paste into Cloud SQL Studio (movetrack-db) and run.
--
-- Safe to re-run any time; it computes every date from CURRENT_DATE, so
-- nothing in here goes stale. Re-run it within a year to roll the closed
-- dates forward (they cover the next 12 months from the day you run it).
--
-- What it sets on the demo vendor (token 'demo', "Acme Van Lines" — the
-- vendor /widget-demo embeds):
--   1. Simulated 10% deposit (payments_mode + an active rate card whose data
--      carries depositPct; a new card version is inserted only if missing).
--   2. Capacity 2 jobs/day.
--   3. Closed on the 15th of every month for the next 12 months
--      (demo line: "can you do the 15th?" → the agent offers alternatives).
--   4. The COI / HOA intake question.
--   5. Clears old demo reservations so the mover dashboard and calendar
--      start clean (only the demo vendor's rows; nothing references them).

BEGIN;

UPDATE companies
SET payments_mode    = 'simulated',
    capacity_per_day = 2,
    blackout_days    = (
      SELECT COALESCE(jsonb_agg(to_char(d, 'YYYY-MM-DD') ORDER BY d), '[]'::jsonb)
      FROM generate_series(
             date_trunc('month', CURRENT_DATE) + INTERVAL '14 days',
             date_trunc('month', CURRENT_DATE) + INTERVAL '12 months 14 days',
             INTERVAL '1 month') AS d
      WHERE d::date > CURRENT_DATE
    ),
    intake_specs     = '[{"key":"coi","question":"Does either building require a certificate of insurance (COI) or have HOA move-in rules?"}]'::jsonb
WHERE token = 'demo';

-- Rate cards are immutable once quoted against, so a missing depositPct is
-- fixed by inserting the next version, never by editing the old one.
INSERT INTO rate_cards (company_id, version, active, data)
SELECT c.id, rc.version + 1, TRUE, rc.data || '{"depositPct": 10}'::jsonb
FROM companies c
JOIN LATERAL (
  SELECT version, data FROM rate_cards
  WHERE company_id = c.id ORDER BY version DESC LIMIT 1
) rc ON TRUE
WHERE c.token = 'demo'
  AND COALESCE((rc.data->>'depositPct')::numeric, 0) <= 0;

UPDATE rate_cards SET active = FALSE
WHERE company_id = (SELECT id FROM companies WHERE token = 'demo')
  AND version < (SELECT MAX(version) FROM rate_cards
                 WHERE company_id = (SELECT id FROM companies WHERE token = 'demo'));

DELETE FROM booking_reservations
WHERE company_id = (SELECT id FROM companies WHERE token = 'demo');

COMMIT;

-- Check: expect payments_mode 'simulated', capacity 2, 12 dates on the 15th,
-- 1 intake spec, and an active card with depositPct 10.
SELECT c.name, c.payments_mode, c.capacity_per_day,
       jsonb_array_length(c.blackout_days)  AS closed_dates,
       c.blackout_days->>0                  AS next_closed,
       c.blackout_days->>-1                 AS last_closed,
       jsonb_array_length(c.intake_specs)   AS intake_specs,
       rc.version                           AS active_card_version,
       rc.data->>'depositPct'               AS deposit_pct
FROM companies c
LEFT JOIN rate_cards rc ON rc.company_id = c.id AND rc.active
WHERE c.token = 'demo';
