package dev.we3kings.nexusmoves.data.events

/**
 * Client telemetry — port of iOS ClientEventLogger (POST /client-events,
 * fire-and-forget, batched): upload_started/succeeded/failed, scan lifecycle,
 * review outcomes. Same event names as iOS so dashboards stay unified.
 * TODO(android-port).
 */
object ClientEventLogger
