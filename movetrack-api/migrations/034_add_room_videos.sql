-- 034_add_room_videos.sql
--
-- Room walkthrough videos, so a user can share the actual room videos with
-- moving companies alongside the item inventory. The video file itself already
-- lives in GCS (uploaded via the nexus upload route); this row links it to the
-- user/room and powers the "walkthroughs" section of a shared mover report.

CREATE TABLE IF NOT EXISTS room_videos (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    location_id BIGINT REFERENCES locations(id) ON DELETE SET NULL,
    room_name VARCHAR(255),
    video_url TEXT,
    gcs_bucket TEXT,
    gcs_path TEXT,
    thumbnail_url TEXT,
    mime_type VARCHAR(100),
    item_count INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_room_videos_user ON room_videos(user_id);
