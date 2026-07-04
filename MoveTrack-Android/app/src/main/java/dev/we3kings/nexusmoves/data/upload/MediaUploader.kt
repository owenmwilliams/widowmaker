package dev.we3kings.nexusmoves.data.upload

/**
 * Media uploads — port of iOS NexusService.uploadMedia/uploadMediaDirect:
 * - photos: multipart POST /upload, JPEG q0.8, reject > 30 MB
 * - videos: signed-URL PUT with byte-level progress callbacks
 * - byteLength recorded client-side so the server fail-louds on truncation
 *
 * ANDROID-SPECIFIC: iOS gets 720p transcode free from UIImagePickerController;
 * here library/camera videos must run through Media3 Transformer (H.264 720p)
 * BEFORE upload or long walkthroughs balloon past upload limits.
 * TODO(android-port).
 */
class MediaUploader
