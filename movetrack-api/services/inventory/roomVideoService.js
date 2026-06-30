'use strict';

/**
 * roomVideoService.js
 *
 * Persists room walkthrough videos so they can be shared with moving companies
 * alongside the item inventory. The video itself already lives in GCS (uploaded
 * via the nexus upload route); here we record a row linking it to the user/room.
 */

const knex = require('../infra/knex');

/** Extract { bucket, path } from a public-style GCS URL, or null. */
function gcsPathFromUrl(url) {
  if (!url) return null;
  const m = String(url).match(/storage\.googleapis\.com\/([^/]+)\/(.+)$/);
  return m ? { bucket: m[1], path: m[2] } : null;
}

async function recordRoomVideo(userId, { videoUrl, mimeType = null, roomName = null, locationId = null, itemCount = null, thumbnailUrl = null } = {}) {
  if (!userId || !videoUrl) return null;
  const parsed = gcsPathFromUrl(videoUrl);
  const [row] = await knex('room_videos')
    .insert({
      user_id: userId,
      location_id: locationId,
      room_name: roomName,
      video_url: videoUrl,
      gcs_bucket: parsed ? parsed.bucket : null,
      gcs_path: parsed ? parsed.path : null,
      thumbnail_url: thumbnailUrl,
      mime_type: mimeType,
      item_count: itemCount,
    })
    .returning('*');
  return row;
}

async function listRoomVideos(userId) {
  return knex('room_videos').where({ user_id: userId }).orderBy('created_at', 'asc');
}

module.exports = { recordRoomVideo, listRoomVideos, gcsPathFromUrl };
