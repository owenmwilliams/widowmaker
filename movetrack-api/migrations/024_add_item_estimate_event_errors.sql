-- Add error metadata to item_estimate_events for failed AI estimates
ALTER TABLE item_estimate_events
  ADD COLUMN IF NOT EXISTS error_message TEXT,
  ADD COLUMN IF NOT EXISTS error_stage VARCHAR(64);
