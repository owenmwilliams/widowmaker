'use strict';

const { countItemsAdded, deriveTurnError } = require('../../agents/censusAgent');

describe('countItemsAdded', () => {
  test('counts a successful legacy add_item', () => {
    const actions = [{ tool: 'add_item', result: { success: true } }];
    expect(countItemsAdded(actions)).toBe(1);
  });

  test('does not count a failed add_item', () => {
    const actions = [{ tool: 'add_item', result: { success: false, error: 'No location found' } }];
    expect(countItemsAdded(actions)).toBe(0);
  });

  test('counts the batched add_items path by its `added` field, not top-level success', () => {
    // add_items always returns success: true (it's a batch); the real count is `added`.
    const actions = [{ tool: 'add_items', result: { success: true, added: 24, failed: 1, total: 25 } }];
    expect(countItemsAdded(actions)).toBe(24);
  });

  test('sums add_item and add_items across multiple tool calls in one turn', () => {
    const actions = [
      { tool: 'add_item', result: { success: true } },
      { tool: 'add_items', result: { success: true, added: 5 } },
      { tool: 'add_item', result: { success: false } },
      { tool: 'add_items', result: { success: true, added: 3 } },
      { tool: 'search_items', result: { success: true } },
    ];
    expect(countItemsAdded(actions)).toBe(1 + 5 + 3);
  });

  test('ignores add_items with a non-numeric added field', () => {
    const actions = [{ tool: 'add_items', result: { success: true } }];
    expect(countItemsAdded([])).toBe(0);
    expect(countItemsAdded(actions)).toBe(0);
  });
});

describe('deriveTurnError', () => {
  test('no error on a clean turn', () => {
    const actions = [{ tool: 'add_item', result: { success: true } }];
    expect(deriveTurnError(actions)).toEqual({ hadError: false, message: null });
  });

  test('flags a failed tool call', () => {
    const actions = [{ tool: 'analyze_photo', result: { success: false, error: 'Failed to download any of the provided photos' } }];
    expect(deriveTurnError(actions)).toEqual({ hadError: true, message: 'Failed to download any of the provided photos' });
  });

  test('flags a successful vision call that carried a parseError (silent item loss)', () => {
    const actions = [{
      tool: 'analyze_video',
      result: { success: true, items: [], parseError: 'Could not parse response as JSON: Unexpected end of input' },
    }];
    const result = deriveTurnError(actions);
    expect(result.hadError).toBe(true);
    expect(result.message).toContain('analyze_video');
    expect(result.message).toContain('Could not parse response as JSON');
  });

  test('does not flag a successful call with no parseError', () => {
    const actions = [{ tool: 'analyze_photo', result: { success: true, items: [{ name: 'Sofa' }], parseError: null } }];
    expect(deriveTurnError(actions).hadError).toBe(false);
  });

  test('reports the first failure when multiple tool calls fail', () => {
    const actions = [
      { tool: 'add_item', result: { success: true } },
      { tool: 'add_room', result: { success: false, error: 'Room already exists' } },
      { tool: 'analyze_photo', result: { success: false, error: 'Failed to download' } },
    ];
    expect(deriveTurnError(actions)).toEqual({ hadError: true, message: 'Room already exists' });
  });
});
