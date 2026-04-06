'use strict';

/**
 * Item Parsing Utilities
 *
 * Pure helpers for normalising raw query/body values into typed item fields.
 * Shared between the items route handler and itemEstimationService.
 */

/**
 * Parse a dimension string like "10x5x3" or "10 × 5 × 3" into { length, width, height }.
 * Returns null if the string is invalid or any dimension is non-positive.
 */
function parseDimensionString(value) {
  if (!value || typeof value !== 'string') return null;
  const cleaned = value.toLowerCase().replace(/[^0-9.x×]/g, '');
  const parts = cleaned.split(/[x×]/).filter(Boolean);
  if (parts.length !== 3) return null;
  const numbers = parts.map(Number);
  if (numbers.some(num => !Number.isFinite(num) || num <= 0)) return null;
  return { length: numbers[0], width: numbers[1], height: numbers[2] };
}

/**
 * Coerce a value to a finite number, returning null for null/undefined/NaN/Infinity.
 */
function toOptionalNumber(value) {
  if (value === null || value === undefined) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

/**
 * Normalise a tags value (JSON string, CSV string, or array) into a clean string array.
 * Returns [] for falsy values (except empty string which also returns []).
 */
function normalizeTags(value) {
  if (!value && value !== '') return [];
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === 'string' ? entry.trim() : String(entry)))
      .filter(Boolean);
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed
          .map((entry) => (typeof entry === 'string' ? entry.trim() : String(entry)))
          .filter(Boolean);
      }
    } catch (_) {
      // Fall through to comma-split
    }
    return value.split(',').map((entry) => entry.trim()).filter(Boolean);
  }
  return [];
}

module.exports = { parseDimensionString, toOptionalNumber, normalizeTags };
