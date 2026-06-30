'use strict';

/**
 * shareService.js
 *
 * Tokenized, public, read-only inventory sharing for moving companies.
 *
 * A share is an opaque token that maps to a user (and optionally a move). The
 * public endpoint resolves a share ONLY by token, validates it (not revoked, not
 * expired), and returns a "mover-ready" report: items grouped by location → room
 * with quantities, weights, cubic feet, fragile/oversized flags, access notes,
 * and aggregate totals. No authentication, no other-user data, no account needed.
 */

const crypto = require('crypto');
const knex = require('../infra/knex');
const { getInventorySnapshot } = require('./inventorySummaryQueryService');

// An item needs special handling if a single unit is heavy or large.
const OVERSIZED_WEIGHT_LBS = 150;
const OVERSIZED_DIMENSION_IN = 72;

function generateToken() {
  return crypto.randomBytes(12).toString('base64url'); // ~16 url-safe chars
}

function shareUrl(token) {
  const base = (process.env.APP_BASE_URL || 'https://reloprep.com').replace(/\/$/, '');
  return `${base}/share/${token}`;
}

function publicShare(row) {
  if (!row) return null;
  return {
    token: row.token,
    url: shareUrl(row.token),
    title: row.title || null,
    moveId: row.move_id || null,
    createdAt: row.created_at,
    expiresAt: row.expires_at || null,
    revokedAt: row.revoked_at || null,
    viewCount: row.view_count || 0,
    lastViewedAt: row.last_viewed_at || null,
  };
}

// ── Share management (authenticated) ─────────────────────────────────────────

async function createShare(userId, { moveId = null, title = null, expiresInDays = null } = {}) {
  const token = generateToken();
  let expiresAt = null;
  if (expiresInDays && Number(expiresInDays) > 0) {
    expiresAt = new Date(Date.now() + Number(expiresInDays) * 24 * 60 * 60 * 1000);
  }
  const [row] = await knex('inventory_shares')
    .insert({ token, user_id: userId, move_id: moveId, title, expires_at: expiresAt })
    .returning('*');
  return publicShare(row);
}

async function listShares(userId) {
  const rows = await knex('inventory_shares')
    .where({ user_id: userId })
    .orderBy('created_at', 'desc');
  return rows.map(publicShare);
}

async function revokeShare(userId, token) {
  const updated = await knex('inventory_shares')
    .where({ user_id: userId, token })
    .whereNull('revoked_at')
    .update({ revoked_at: knex.fn.now() })
    .returning('*');
  return updated.length ? publicShare(updated[0]) : null;
}

// ── Public resolution ────────────────────────────────────────────────────────

/** Validate a token and return the share row, or a reason it's invalid. */
async function resolveToken(token) {
  const row = await knex('inventory_shares').where({ token }).first();
  if (!row) return { ok: false, status: 404, error: 'Share not found' };
  if (row.revoked_at) return { ok: false, status: 410, error: 'This share link has been revoked' };
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
    return { ok: false, status: 410, error: 'This share link has expired' };
  }
  return { ok: true, row };
}

/**
 * Build a mover-ready report for a user: items grouped by location → room, with
 * per-item quantity/weight/dimensions/volume/fragile, access info per location,
 * and aggregate totals + special-handling flags.
 */
async function buildMoverReport(userId, moveId = null) {
  const snapshot = await getInventorySnapshot(userId);

  const roomById = new Map(snapshot.collections.map((c) => [String(c.id), c]));

  // Access info isn't in the snapshot's location select — pull it for these ids.
  const locationIds = snapshot.locations.map((l) => l.id);
  const accessRows = locationIds.length
    ? await knex('locations')
        .select(
          'id', 'has_stairs', 'number_of_flights', 'has_elevator',
          'parking_situation', 'entry_type', 'access_notes'
        )
        .whereIn('id', locationIds)
    : [];
  const accessById = new Map(accessRows.map((a) => [String(a.id), a]));

  // Scaffold a location → rooms structure preserving the user's locations.
  const locations = snapshot.locations.map((loc) => {
    const a = accessById.get(String(loc.id)) || {};
    return {
      id: loc.id,
      name: loc.name,
      type: loc.location_type,
      address: [loc.address, loc.city, loc.state, loc.zip].filter(Boolean).join(', ') || null,
      access: {
        hasStairs: a.has_stairs ?? null,
        numberOfFlights: a.number_of_flights ?? null,
        hasElevator: a.has_elevator ?? null,
        parking: a.parking_situation ?? null,
        entryType: a.entry_type ?? null,
        notes: a.access_notes ?? null,
      },
      rooms: new Map(), // roomName -> { name, items: [] }
    };
  });
  const locById = new Map(locations.map((l) => [String(l.id), l]));
  // Bucket for items whose location can't be resolved.
  const unassigned = { id: null, name: 'Unassigned', type: null, address: null, access: {}, rooms: new Map() };

  const totals = { itemCount: 0, totalWeightLbs: 0, totalVolumeCuFt: 0, fragileCount: 0, missingWeight: 0, missingDimensions: 0 };
  const specialItems = [];

  for (const item of snapshot.items) {
    const qty = item.quantity || 1;
    const room = roomById.get(String(item.collection_id));
    const locKey = String(item.location_id ?? room?.location_id ?? '');
    const loc = locById.get(locKey) || unassigned;
    const roomName = room?.name || 'Unsorted';

    if (!loc.rooms.has(roomName)) loc.rooms.set(roomName, { name: roomName, items: [] });

    const unitWeight = Number(item.weight_lbs) || 0;
    const hasDims = item.length_in && item.width_in && item.height_in;
    const unitVolume = hasDims ? (item.length_in * item.width_in * item.height_in) / 1728 : 0;
    const oversized = unitWeight >= OVERSIZED_WEIGHT_LBS ||
      [item.length_in, item.width_in, item.height_in].some((d) => Number(d) >= OVERSIZED_DIMENSION_IN);

    const reportItem = {
      name: item.name,
      quantity: qty,
      weightLbs: unitWeight || null,
      dimensionsIn: hasDims ? { length: item.length_in, width: item.width_in, height: item.height_in } : null,
      volumeCuFt: unitVolume ? Math.round(unitVolume * qty * 100) / 100 : null,
      fragile: !!item.fragile,
      oversized,
      material: item.material || null,
      pictureUrl: item.picture_url || null,
    };
    loc.rooms.get(roomName).items.push(reportItem);

    totals.itemCount += qty;
    totals.totalWeightLbs += unitWeight * qty;
    totals.totalVolumeCuFt += unitVolume * qty;
    if (item.fragile) totals.fragileCount += qty;
    if (!unitWeight) totals.missingWeight += qty;
    if (!hasDims) totals.missingDimensions += qty;
    if (item.fragile || oversized) specialItems.push({ name: item.name, quantity: qty, fragile: !!item.fragile, oversized });
  }

  totals.totalWeightLbs = Math.round(totals.totalWeightLbs);
  totals.totalVolumeCuFt = Math.round(totals.totalVolumeCuFt * 100) / 100;

  // Materialize the Maps into arrays, dropping empty locations.
  const allLocations = [...locations, unassigned]
    .map((l) => ({ ...l, rooms: [...l.rooms.values()] }))
    .filter((l) => l.rooms.length > 0);

  // Optional move context (origin/destination).
  let move = null;
  if (moveId) {
    const m = await knex('saved_moves as sm')
      .leftJoin('locations as o', 'sm.origin_location_id', 'o.id')
      .leftJoin('locations as d', 'sm.destination_location_id', 'd.id')
      .select(
        'sm.id', 'sm.name', 'sm.move_date',
        'o.name as origin_name', 'o.city as origin_city', 'o.state as origin_state',
        'd.name as destination_name', 'd.city as destination_city', 'd.state as destination_state'
      )
      .where({ 'sm.id': moveId, 'sm.user_id': userId })
      .first();
    if (m) {
      move = {
        name: m.name,
        moveDate: m.move_date,
        origin: m.origin_name ? { name: m.origin_name, city: m.origin_city, state: m.origin_state } : null,
        destination: m.destination_name ? { name: m.destination_name, city: m.destination_city, state: m.destination_state } : null,
      };
    }
  }

  return { totals, specialItems, locations: allLocations, move };
}

/** Public: resolve a token → mover report, recording the view. */
async function getSharedReport(token) {
  const resolved = await resolveToken(token);
  if (!resolved.ok) return resolved;

  const { row } = resolved;
  const report = await buildMoverReport(row.user_id, row.move_id);

  // Record the view (best-effort; never block the response).
  knex('inventory_shares')
    .where({ id: row.id })
    .update({ view_count: knex.raw('view_count + 1'), last_viewed_at: knex.fn.now() })
    .catch(() => {});

  return {
    ok: true,
    report: {
      title: row.title || null,
      generatedAt: new Date().toISOString(),
      ...report,
    },
  };
}

module.exports = {
  createShare,
  listShares,
  revokeShare,
  resolveToken,
  buildMoverReport,
  getSharedReport,
  shareUrl,
};
