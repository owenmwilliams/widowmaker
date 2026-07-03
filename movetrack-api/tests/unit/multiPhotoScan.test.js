'use strict';

/**
 * Multi-photo scans: up to 5 images attach to ONE scan job and are analyzed
 * together (analyzePhotoForInventory files[] mode), so the user gets a single
 * review card — not five. Single-media jobs must be byte-for-byte unchanged.
 */

const mockAnalyzeVideo = jest.fn();
const mockAnalyzePhoto = jest.fn();

jest.mock('../../services/infra/scanEventsService', () => ({
  createScanRecorder: jest.fn(() => ({ onStage: jest.fn(), finish: jest.fn() })),
  recordScanEvent: jest.fn(),
}));
jest.mock('../../services/inventory/mediaInventoryWorkflowService', () => ({
  analyzeVideoForInventory: (...a) => mockAnalyzeVideo(...a),
  analyzePhotoForInventory: (...a) => mockAnalyzePhoto(...a),
}));
jest.mock('../../services/infra/metricsService', () => ({
  logInteraction: jest.fn().mockResolvedValue(undefined),
}));

const mockState = { inserted: [], claimable: null };
jest.mock('../../services/infra/db', () => ({
  db: {
    one: jest.fn(async (sql, params) => {
      mockState.inserted.push({ sql, params });
      return { id: 'job-1', session_id: 'sess-1', _inserted: true };
    }),
    oneOrNone: jest.fn(async (sql) => {
      if (/UPDATE scan_jobs[\s\S]*RETURNING/.test(sql) && /processing/.test(sql)) {
        const job = mockState.claimable;
        mockState.claimable = null;
        return job;
      }
      // resolveSessionId lookups etc.
      return { id: 'sess-1' };
    }),
    none: jest.fn(async (sql, params) => { mockState.inserted.push({ sql, params }); }),
    result: jest.fn(async () => ({ rowCount: 1 })),
    any: jest.fn(async () => []),
  },
}));

const scanJobs = require('../../services/inventory/scanJobService');

beforeEach(() => {
  mockState.inserted.length = 0;
  mockState.claimable = null;
  mockAnalyzePhoto.mockReset();
  mockAnalyzeVideo.mockReset();
});

describe('createJob with a photo batch', () => {
  test('stores media_urls and writes one transcript attachment per photo', async () => {
    const urls = [
      'https://storage.googleapis.com/b/users/u1/chat/nexus/a.jpg',
      'https://storage.googleapis.com/b/users/u1/chat/nexus/b.jpg',
      'https://storage.googleapis.com/b/users/u1/chat/nexus/c.jpg',
    ];
    await scanJobs.createJob('u1', { mediaUrl: urls[0], mediaUrls: urls, mimeType: 'image/jpeg' });

    const insert = mockState.inserted.find(c => /INSERT INTO scan_jobs/.test(c.sql));
    expect(insert.sql).toContain('media_urls');
    const storedBatch = insert.params.find(p => typeof p === 'string' && p.startsWith('['));
    expect(JSON.parse(storedBatch)).toEqual(urls);

    const transcript = mockState.inserted.find(c => /INSERT INTO nexus_messages/.test(c.sql));
    const attachments = JSON.parse(transcript.params[2]);
    expect(attachments).toHaveLength(3);
    expect(attachments.map(a => a.url)).toEqual(urls);
    expect(attachments.every(a => a.mimeType === 'image/jpeg')).toBe(true);
  });

  test('a single photo keeps media_urls NULL (legacy shape untouched)', async () => {
    const url = 'https://storage.googleapis.com/b/users/u1/chat/nexus/a.jpg';
    await scanJobs.createJob('u1', { mediaUrl: url, mediaUrls: [url], mimeType: 'image/jpeg' });
    const insert = mockState.inserted.find(c => /INSERT INTO scan_jobs/.test(c.sql));
    expect(insert.params).toContain(null); // the media_urls slot
    expect(insert.params.some(p => typeof p === 'string' && p.startsWith('['))).toBe(false);
  });

  test('a video batch is rejected — batches are photos only', async () => {
    await expect(scanJobs.createJob('u1', {
      mediaUrl: 'https://storage.googleapis.com/b/users/u1/chat/nexus/a.mov',
      mediaUrls: ['https://x/a.mov', 'https://x/b.mov'],
      mimeType: 'video/quicktime',
    })).rejects.toThrow(/photos/i);
  });
});

describe('processJob dispatch for a batch', () => {
  function photoJob(mediaUrls) {
    return {
      id: '22222222-2222-4222-8222-222222222222',
      user_id: 'u1',
      session_id: 'sess-1',
      media_url: 'https://storage.googleapis.com/b/users/u1/chat/nexus/a.jpg',
      media_urls: mediaUrls,
      mime_type: 'image/jpeg',
      media_kind: 'photo',
      room_hint: 'Kitchen',
      caption: null,
      plan: 'basic',
      attempts: 1,
      created_at: new Date().toISOString(),
      started_at: new Date().toISOString(),
    };
  }

  test('a batch job analyzes all photos together via files[]', async () => {
    const urls = [
      'https://storage.googleapis.com/b/users/u1/chat/nexus/a.jpg',
      'https://storage.googleapis.com/b/users/u1/chat/nexus/b.jpg',
    ];
    mockState.claimable = photoJob(urls);
    mockAnalyzePhoto.mockResolvedValue({ success: true, items: [{ name: 'Sofa' }], itemCount: 1 });

    await scanJobs.processJob();

    expect(mockAnalyzePhoto).toHaveBeenCalledTimes(1);
    const args = mockAnalyzePhoto.mock.calls[0][0];
    expect(args.files).toHaveLength(2);
    expect(args.files.map(f => f.file_url)).toEqual(urls);
    expect(args.files.every(f => f.mime_type === 'image/jpeg')).toBe(true);
    expect(args.mode).toBe('multi_item');
    expect(args.room_hint).toBe('Kitchen');
  });

  test('a single-photo job keeps the legacy file_url shape', async () => {
    mockState.claimable = photoJob(null);
    mockAnalyzePhoto.mockResolvedValue({ success: true, items: [], itemCount: 0 });

    await scanJobs.processJob();

    const args = mockAnalyzePhoto.mock.calls[0][0];
    expect(args.files).toBeUndefined();
    expect(args.file_url).toBe('https://storage.googleapis.com/b/users/u1/chat/nexus/a.jpg');
  });
});

describe('toDTO', () => {
  test('exposes mediaUrls when set and null when not', () => {
    const base = { id: 'j', status: 'completed', media_kind: 'photo', media_url: 'u' };
    expect(scanJobs.toDTO({ ...base, media_urls: ['u', 'v'] }).mediaUrls).toEqual(['u', 'v']);
    expect(scanJobs.toDTO(base).mediaUrls).toBeNull();
  });
});
