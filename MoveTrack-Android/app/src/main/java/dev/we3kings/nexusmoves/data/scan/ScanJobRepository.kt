package dev.we3kings.nexusmoves.data.scan

/**
 * Durable scan jobs — port of iOS NexusViewModel.runScanJob/pollScanJob:
 * - idempotency key = SHA-256 of media bytes (batch: hash of concatenated bytes)
 * - create job (mediaUrls for 2–5 photo batches), poll every 3s to terminal,
 *   15-min deadline, tolerate transient poll failures (job survives app death)
 * - job is consumed when the user CLOSES the review card, not when shown
 * - reload path: GET /scan-jobs re-materializes finished-but-unseen jobs
 * TODO(android-port).
 */
class ScanJobRepository
