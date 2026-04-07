'use strict';

/**
 * Special Handling Service
 *
 * Identifies items that need special attention: heavy, oversized, fragile.
 */

const knex = require('../infra/knex');

/**
 * Flag items that need special handling during a move.
 *
 * @param {string} userId
 * @returns {object} - { flaggedCount, items, summary }
 */
async function flagSpecialItems(userId) {
  const items = await knex('items')
    .select(
      'items.id', 'items.name', 'items.weight_lbs',
      'items.length_in', 'items.width_in', 'items.height_in',
      'items.fragile', 'items.description',
      'collections.name as room_name'
    )
    .leftJoin('collections', 'items.collection_id', 'collections.id')
    .where('items.user_id', userId);

  const flags = [];

  for (const item of items) {
    const issues = [];

    // Heavy items
    if (item.weight_lbs && item.weight_lbs > 300) {
      issues.push(`Very heavy (${item.weight_lbs} lbs) — may need extra movers or equipment`);
    }

    // Oversized items (won't fit through standard door: 36" wide, 80" tall)
    const dims = [item.length_in, item.width_in, item.height_in].filter(Boolean).sort((a, b) => b - a);
    if (dims.length >= 2) {
      if (dims[0] > 84) {
        issues.push(`Very tall/long (${dims[0]}") — check doorways and hallways`);
      }
      if (dims[1] > 36) {
        issues.push(`Wide (${dims[1]}") — may not fit through standard 36" doorway`);
      }
    }

    // Fragile items
    if (item.fragile) {
      issues.push('Fragile — needs special packing/handling');
    }

    if (issues.length > 0) {
      flags.push({
        name: item.name,
        room: item.room_name,
        weight: item.weight_lbs,
        dimensions: dims.length === 3 ? `${dims[0]}" × ${dims[1]}" × ${dims[2]}"` : null,
        issues,
      });
    }
  }

  return {
    success: true,
    flaggedCount: flags.length,
    items: flags,
    summary: flags.length === 0
      ? 'No items flagged for special handling.'
      : `${flags.length} item(s) need special attention.`,
  };
}

module.exports = {
  flagSpecialItems,
};
