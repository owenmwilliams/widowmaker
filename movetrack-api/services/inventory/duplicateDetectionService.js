'use strict';

/**
 * Duplicate Detection Service
 *
 * Finds potential duplicate items using Levenshtein string similarity.
 */

const knex = require('../infra/knex');

/**
 * Levenshtein distance between two strings.
 */
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[0][i] = i;
  for (let j = 0; j <= n; j++) dp[j][0] = j;
  for (let j = 1; j <= n; j++) {
    for (let i = 1; i <= m; i++) {
      dp[j][i] = Math.min(
        dp[j][i - 1] + 1,
        dp[j - 1][i] + 1,
        dp[j - 1][i - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return dp[n][m];
}

/**
 * Find potential duplicate items by name similarity.
 */
async function findDuplicates(userId, args) {
  const threshold = Math.max(50, Math.min(95, args.threshold || 70));

  let query = knex('items')
    .select('items.id', 'items.name', 'items.quantity', 'items.description',
            'items.picture_url', 'collections.name as room_name')
    .leftJoin('collections', 'items.collection_id', 'collections.id')
    .where('items.user_id', userId);

  if (args.room_name) {
    query = query.whereRaw('LOWER(collections.name) = ?', [args.room_name.toLowerCase()]);
  }

  const items = await query.orderBy('items.name');

  const pairs = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = (items[i].name || '').toLowerCase().trim();
      const b = (items[j].name || '').toLowerCase().trim();
      if (!a || !b) continue;

      const dist = levenshtein(a, b);
      const maxLen = Math.max(a.length, b.length);
      let similarity = Math.round(((maxLen - dist) / maxLen) * 1000) / 10;

      // Boost if same room
      if (items[i].room_name && items[j].room_name &&
          items[i].room_name.toLowerCase() === items[j].room_name.toLowerCase()) {
        similarity = Math.min(100, similarity + 10);
      }

      if (similarity >= threshold) {
        pairs.push({
          itemA: { id: items[i].id, name: items[i].name, room: items[i].room_name, quantity: items[i].quantity },
          itemB: { id: items[j].id, name: items[j].name, room: items[j].room_name, quantity: items[j].quantity },
          similarity,
        });
      }
    }
  }

  pairs.sort((a, b) => b.similarity - a.similarity);

  return {
    success: true,
    duplicateCount: pairs.length,
    pairs: pairs.slice(0, 20),
    message: pairs.length === 0
      ? 'No potential duplicates found.'
      : `Found ${pairs.length} potential duplicate pair(s).`,
  };
}

module.exports = {
  findDuplicates,
  levenshtein,
};
