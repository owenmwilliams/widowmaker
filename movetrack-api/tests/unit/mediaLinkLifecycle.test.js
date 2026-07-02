/**
 * Regression test for the arbiter's blocker #2 on PR #51 (issue #40, Pathway A):
 * crops/frames/thumbnails ingested via mediaAssetService.ingestUpload land as
 * `status:'uploaded', is_orphaned:true` and nothing ever linked them, so the
 * 48h orphan cleanup (cleanupUnlinkedAssets) deleted the GCS object out from
 * under a committed item days later. Same problem for a direct-PUT video
 * reservation that room_videos still references.
 *
 * This simulates that exact scenario end-to-end against mediaAssetService
 * itself — ingest two assets from the "same scan", link one the way a real
 * item commit / recordRoomVideo call now does, run the cleanup, and assert
 * only the unlinked one is deleted. Uses a minimal in-memory fake for `knex`
 * (no live Postgres in this environment) that implements just the query
 * shapes mediaAssetService actually issues.
 */

function makeFakeKnex() {
  const tables = {};
  let nextId = 1;

  function buildFilter(args) {
    if (args.length === 1 && typeof args[0] === 'object') {
      const obj = args[0];
      return (row) => Object.entries(obj).every(([k, v]) => row[k] === v);
    }
    if (args.length === 2) {
      const [field, value] = args;
      return (row) => row[field] === value;
    }
    if (args.length === 3) {
      const [field, op, value] = args;
      const target = value instanceof Date ? value.getTime() : value;
      if (op === '<') return (row) => new Date(row[field]).getTime() < target;
      if (op === '>') return (row) => new Date(row[field]).getTime() > target;
      return (row) => row[field] === value;
    }
    return () => true;
  }

  class QueryBuilder {
    constructor(rows) {
      this.rows = rows;
      this.filters = [];
      this.mode = 'select';
      this.payload = null;
      this.order = null;
    }
    where(...args) { this.filters.push(buildFilter(args)); return this; }
    andWhere(...args) { return this.where(...args); }
    orderBy(field, dir = 'asc') { this.order = { field, dir }; return this; }
    first() { this.mode = 'first'; return this; }
    update(obj) { this.mode = 'update'; this.payload = obj; return this; }
    delete() { this.mode = 'delete'; return this; }
    insert(obj) { this.mode = 'insert'; this.payload = obj; return this; }
    returning() { if (this.mode === 'insert') this.mode = 'insert-returning'; return this; }
    transacting() { return this; }

    _matching() {
      return this.rows.filter((row) => this.filters.every((f) => f(row)));
    }

    then(resolve, reject) {
      try {
        let result;
        if (this.mode === 'insert' || this.mode === 'insert-returning') {
          const row = { id: nextId++, ...this.payload };
          this.rows.push(row);
          result = this.mode === 'insert-returning' ? [row] : undefined;
        } else if (this.mode === 'update') {
          const matches = this._matching();
          matches.forEach((row) => Object.assign(row, this.payload));
          result = matches.length;
        } else if (this.mode === 'delete') {
          const matches = this._matching();
          matches.forEach((row) => {
            const idx = this.rows.indexOf(row);
            if (idx >= 0) this.rows.splice(idx, 1);
          });
          result = matches.length;
        } else if (this.mode === 'first') {
          result = this._matching()[0];
        } else {
          let matches = this._matching();
          if (this.order) {
            const { field, dir } = this.order;
            matches = [...matches].sort((a, b) => {
              const diff = new Date(a[field]).getTime() - new Date(b[field]).getTime();
              return dir === 'desc' ? -diff : diff;
            });
          }
          result = matches;
        }
        resolve(result);
      } catch (err) {
        reject(err);
      }
    }
  }

  function knexFn(tableName) {
    if (!tables[tableName]) tables[tableName] = [];
    return new QueryBuilder(tables[tableName]);
  }
  knexFn.transaction = async (cb) => cb({});
  knexFn.__tables = tables;
  return knexFn;
}

const mockKnex = makeFakeKnex();
jest.mock('../../services/infra/knex', () => mockKnex);

const mediaAssetService = require('../../services/infra/mediaAssetService');

function backdateRow(url, hoursAgo) {
  const row = mockKnex.__tables.image_uploads.find((r) => r.image_url === url);
  row.uploaded_at = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);
  return row;
}

describe('media link/confirm lifecycle vs the 48h orphan cleanup', () => {
  test('a crop linked to a committed item survives cleanup; an unlinked one from the same scan does not', async () => {
    const kept = await mediaAssetService.ingestUpload({
      userId: 'user-1',
      buffer: Buffer.from('kept crop bytes'),
      mimeType: 'image/jpeg',
      source: 'derived_crop',
    });
    const discarded = await mediaAssetService.ingestUpload({
      userId: 'user-1',
      buffer: Buffer.from('discarded crop bytes'),
      mimeType: 'image/jpeg',
      source: 'derived_crop',
    });

    // Both assets are from the same scan and start out identically orphaned.
    expect(mockKnex.__tables.image_uploads.find((r) => r.asset_uuid === kept.assetId).status).toBe('uploaded');
    expect(mockKnex.__tables.image_uploads.find((r) => r.asset_uuid === discarded.assetId).status).toBe('uploaded');

    // Simulate the user keeping `kept` and committing it as an item — this is
    // exactly the call inventoryMutationService.addItem now makes.
    await mediaAssetService.markAssetLinkedByUrl(kept.url, 42);

    // `discarded` was shown in the review card but never added — it stays
    // unlinked, same as before this fix.

    // Age both past the cleanup threshold, as if the scan happened 3 days ago.
    backdateRow(kept.url, 72);
    backdateRow(discarded.url, 72);

    const result = await mediaAssetService.cleanupUnlinkedAssets({ olderThanHours: 48 });

    expect(result.deleted).toBe(1);
    expect(mockKnex.__tables.image_uploads.some((r) => r.asset_uuid === kept.assetId)).toBe(true);
    expect(mockKnex.__tables.image_uploads.some((r) => r.asset_uuid === discarded.assetId)).toBe(false);

    const survivingRow = mockKnex.__tables.image_uploads.find((r) => r.asset_uuid === kept.assetId);
    expect(survivingRow.status).toBe('linked');
    expect(survivingRow.is_orphaned).toBe(false);
  });

  test('a direct-PUT video reservation linked via markAssetLinkedByUrlAsEntity survives cleanup', async () => {
    const video = await mediaAssetService.ingestUpload({
      userId: 'user-2',
      buffer: Buffer.from('a video reservation stand-in'),
      mimeType: 'video/mp4',
      source: 'nexus_chat',
    });

    // Simulate recordRoomVideo confirming the upload once room_videos is written.
    await mediaAssetService.markAssetLinkedByUrlAsEntity(video.url, 'room_video', 7);
    backdateRow(video.url, 72);

    const result = await mediaAssetService.cleanupUnlinkedAssets({ olderThanHours: 48 });

    expect(mockKnex.__tables.image_uploads.some((r) => r.asset_uuid === video.assetId)).toBe(true);
    expect(result.deleted).toBe(0);
  });

  test('an abandoned direct-PUT reservation (never confirmed) is still cleaned up', async () => {
    const abandoned = await mediaAssetService.ingestUpload({
      userId: 'user-3',
      buffer: Buffer.from('never confirmed'),
      mimeType: 'video/mp4',
      source: 'nexus_chat',
    });
    backdateRow(abandoned.url, 72);

    const result = await mediaAssetService.cleanupUnlinkedAssets({ olderThanHours: 48 });

    expect(result.deleted).toBe(1);
    expect(mockKnex.__tables.image_uploads.some((r) => r.asset_uuid === abandoned.assetId)).toBe(false);
  });
});

describe('ingestUpload defaults a missing mime_type instead of throwing (arbiter major #5)', () => {
  test('an omitted mimeType (LLM sometimes drops it) still ingests as image/jpeg', async () => {
    const asset = await mediaAssetService.ingestUpload({
      userId: 'user-4',
      buffer: Buffer.from('a photo the vision call already analyzed'),
      source: 'derived_thumbnail',
      // mimeType intentionally omitted
    });

    expect(asset.mimeType).toBe('image/jpeg');
    const row = mockKnex.__tables.image_uploads.find((r) => r.asset_uuid === asset.assetId);
    expect(row.mime_type).toBe('image/jpeg');
  });

  test('an explicit mimeType is still respected', async () => {
    const asset = await mediaAssetService.ingestUpload({
      userId: 'user-4',
      buffer: Buffer.from('a video'),
      mimeType: 'video/mp4',
      source: 'nexus_chat',
    });

    expect(asset.mimeType).toBe('video/mp4');
  });
});

describe('extensionFor sanitizes the client-supplied filename (arbiter minor)', () => {
  test('a crafted extension segment cannot inject an extra path separator', async () => {
    const asset = await mediaAssetService.ingestUpload({
      userId: 'user-5',
      buffer: Buffer.from('video bytes'),
      mimeType: 'video/mp4',
      originalName: 'x.a/b', // naive `split('.').pop()` would yield "a/b"
      source: 'nexus_chat',
    });

    expect(asset.gcsPath).toBe(`users/user-5/chat/nexus/${asset.assetId}.ab`);
    expect(asset.gcsPath.split('/')).toHaveLength(5); // users/<id>/chat/nexus/<file> — no extra segment
  });
});
