-- 035_add_room_video_notes.sql
--
-- Store the narration transcript/notes captured from a walkthrough video's audio
-- track. When a user talks while filming ("this dresser is solid oak, super
-- heavy"), the vision model returns a short mover-facing summary; we persist it
-- here and surface it under the video on the shared mover report.

ALTER TABLE room_videos ADD COLUMN IF NOT EXISTS notes TEXT;
