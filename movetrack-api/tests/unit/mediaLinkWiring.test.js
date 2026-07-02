/**
 * Regression test for the arbiter's blocker #2 on PR #51 (issue #40, Pathway A):
 * proves the actual call sites — inventoryMutationService.addItem and
 * roomVideoService.recordRoomVideo — invoke the link/confirm step, not just
 * that the underlying mediaAssetService primitives work in isolation
 * (see mediaLinkLifecycle.test.js for that). Mocks the DB layer so this runs
 * without a live Postgres.
 */

jest.mock('../../services/infra/mediaAssetService', () => ({
  markAssetLinkedByUrl: jest.fn().mockResolvedValue(undefined),
  markAssetLinkedByUrlAsEntity: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../services/infra/db', () => ({
  db: {
    // findOrCreateRoom's exact-match lookup — return an existing room so the
    // insert-a-new-room branch (and its own knex calls) never has to run.
    oneOrNone: jest.fn().mockResolvedValue({ id: 7, name: 'Living Room' }),
  },
}));

jest.mock('../../services/workflow/locationQueryService', () => ({
  getPrimaryLocationId: jest.fn().mockResolvedValue('loc-1'),
}));

jest.mock('../../services/workflow/locationMutationService', () => ({}));

jest.mock('../../services/infra/knex', () => {
  const chain = {
    insert: jest.fn().mockReturnThis(),
    transacting: jest.fn().mockReturnThis(),
    returning: jest.fn().mockResolvedValue([{ id: 42, name: 'Test Item' }]),
  };
  const knexFn = jest.fn(() => chain);
  knexFn.transaction = jest.fn(async (cb) => cb({}));
  return knexFn;
});

const mediaAssetService = require('../../services/infra/mediaAssetService');
const mutation = require('../../services/inventory/inventoryMutationService');

describe('inventoryMutationService.addItem links its picture on commit', () => {
  beforeEach(() => jest.clearAllMocks());

  test('links the picture_url to the newly-created item id', async () => {
    const pictureUrl = 'https://storage.googleapis.com/bucket/users/u1/derived/crops/abc.jpg';
    await mutation.addItem('user-1', { name: 'Lamp', room_name: 'Living Room', picture_url: pictureUrl });

    expect(mediaAssetService.markAssetLinkedByUrl).toHaveBeenCalledTimes(1);
    expect(mediaAssetService.markAssetLinkedByUrl).toHaveBeenCalledWith(pictureUrl, 42);
  });

  test('does not call the linker when the item has no picture', async () => {
    await mutation.addItem('user-1', { name: 'Lamp', room_name: 'Living Room' });
    expect(mediaAssetService.markAssetLinkedByUrl).not.toHaveBeenCalled();
  });
});

describe('roomVideoService.recordRoomVideo links its video (and thumbnail) on write', () => {
  beforeEach(() => jest.clearAllMocks());

  test('links the video URL and thumbnail URL to the new room_videos row', async () => {
    // roomVideoService's own knex('room_videos').insert(...).returning('*') call
    // needs a row with an id back; reuse the same chain mock shape.
    const roomVideoService = require('../../services/inventory/roomVideoService');
    const videoUrl = 'https://storage.googleapis.com/bucket/users/u1/chat/nexus/vid.mp4';
    const thumbnailUrl = 'https://storage.googleapis.com/bucket/users/u1/derived/thumbnails/frame.jpg';

    await roomVideoService.recordRoomVideo('user-1', { videoUrl, thumbnailUrl, roomName: 'Living Room' });

    expect(mediaAssetService.markAssetLinkedByUrlAsEntity).toHaveBeenCalledWith(videoUrl, 'room_video', 42);
    expect(mediaAssetService.markAssetLinkedByUrlAsEntity).toHaveBeenCalledWith(thumbnailUrl, 'room_video', 42);
  });

  test('does not try to link a missing thumbnail', async () => {
    const roomVideoService = require('../../services/inventory/roomVideoService');
    const videoUrl = 'https://storage.googleapis.com/bucket/users/u1/chat/nexus/vid2.mp4';

    await roomVideoService.recordRoomVideo('user-1', { videoUrl, roomName: 'Living Room' });

    expect(mediaAssetService.markAssetLinkedByUrlAsEntity).toHaveBeenCalledTimes(1);
    expect(mediaAssetService.markAssetLinkedByUrlAsEntity).toHaveBeenCalledWith(videoUrl, 'room_video', 42);
  });
});
