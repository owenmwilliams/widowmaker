/**
 * Unit tests for the pagination helper (services/infra/pagination.js). DB-free.
 */

const { parsePagination, SAFETY_CAP } = require('../../services/infra/pagination');

describe('parsePagination', () => {
  test('defaults to the safety cap when no limit is given', () => {
    expect(parsePagination({})).toEqual({ limit: SAFETY_CAP, offset: 0 });
  });

  test('honors a valid explicit limit and offset', () => {
    expect(parsePagination({ limit: '50', offset: '100' })).toEqual({ limit: 50, offset: 100 });
  });

  test('clamps a too-large limit to the ceiling', () => {
    expect(parsePagination({ limit: String(SAFETY_CAP + 1000) }).limit).toBe(SAFETY_CAP);
  });

  test('falls back to default on invalid/negative limit', () => {
    expect(parsePagination({ limit: 'abc' }).limit).toBe(SAFETY_CAP);
    expect(parsePagination({ limit: '-5' }).limit).toBe(SAFETY_CAP);
    expect(parsePagination({ limit: '0' }).limit).toBe(SAFETY_CAP);
  });

  test('coerces invalid/negative offset to 0', () => {
    expect(parsePagination({ offset: '-10' }).offset).toBe(0);
    expect(parsePagination({ offset: 'xyz' }).offset).toBe(0);
  });

  test('respects a custom defaultLimit and maxLimit', () => {
    expect(parsePagination({}, { defaultLimit: 25, maxLimit: 100 })).toEqual({ limit: 25, offset: 0 });
    expect(parsePagination({ limit: '500' }, { maxLimit: 100 }).limit).toBe(100);
  });
});
