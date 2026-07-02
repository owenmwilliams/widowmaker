/**
 * Regression test for the arbiter finding on PR #51 (issue #40, Pathway A):
 * `censusAgent.js`'s tool-execution dispatch called
 * `analyzePhotoForInventory(args, userId, plan)`/`analyzeVideoForInventory(args, userId, plan)`
 * with only 3 args, so `ctx` was always `{}` inside mediaInventoryWorkflowService
 * and the iOS byteLength → server verification chain never ran, even though
 * every piece of it individually looked wired.
 *
 * This exercises `executeTool` — the exact function the dispatch loop calls —
 * without needing a full Gemini + DB turn, and fails if the deterministic
 * `attachments` array (captured from processMessage's own args) stops reaching
 * `ctx.attachments` on analyze_photo/analyze_video.
 */

jest.mock('../../services/inventory/mediaInventoryWorkflowService', () => ({
  analyzePhotoForInventory: jest.fn().mockResolvedValue({ success: true, items: [] }),
  analyzeVideoForInventory: jest.fn().mockResolvedValue({ success: true, items: [] }),
}));

const media = require('../../services/inventory/mediaInventoryWorkflowService');
const { executeTool } = require('../../agents/censusAgent');

const ATTACHMENTS = [{ url: 'https://storage.googleapis.com/bucket/x.mov', mimeType: 'video/mp4', byteLength: 12345 }];

describe('executeTool — attachments wiring for byteLength verification', () => {
  beforeEach(() => jest.clearAllMocks());

  test('analyze_photo receives ctx.attachments from the turn, not from args', async () => {
    const args = { file_url: 'https://storage.googleapis.com/bucket/x.jpg', mime_type: 'image/jpeg' };
    await executeTool('analyze_photo', args, 'user-1', 'basic', ATTACHMENTS);

    expect(media.analyzePhotoForInventory).toHaveBeenCalledTimes(1);
    const [, , , ctx] = media.analyzePhotoForInventory.mock.calls[0];
    expect(ctx).toBeDefined();
    expect(ctx.attachments).toBe(ATTACHMENTS);
  });

  test('analyze_video receives ctx.attachments from the turn', async () => {
    const args = { file_url: 'https://storage.googleapis.com/bucket/x.mov', mime_type: 'video/mp4' };
    await executeTool('analyze_video', args, 'user-1', 'basic', ATTACHMENTS);

    expect(media.analyzeVideoForInventory).toHaveBeenCalledTimes(1);
    const [, , , ctx] = media.analyzeVideoForInventory.mock.calls[0];
    expect(ctx).toBeDefined();
    expect(ctx.attachments).toBe(ATTACHMENTS);
  });

  test('an unknown tool name fails cleanly instead of throwing', async () => {
    const result = await executeTool('not_a_real_tool', {}, 'user-1', 'basic', ATTACHMENTS);
    expect(result).toEqual({ success: false, error: 'Unknown tool: not_a_real_tool' });
  });
});
