'use strict';

/**
 * Route-level tests for POST /api/move/estimate — the single server-side
 * cost engine (issue #86, M1). The desktop Move tab now renders whatever this
 * endpoint returns instead of running its own client-side math, so these
 * tests pin down the response contract:
 *   • truck  — trucksService.recommendTruckSize
 *   • cost   — moveCostService.estimateMoveCost (DIY + professional ranges)
 *   • labor  — laborEstimationService.estimateLabor
 *
 * The three services are pure math, so the real implementations run; only the
 * db/auth collaborators are mocked (pattern from rescanRecommit.test.js).
 */

jest.mock('../../services/infra/knex', () => ({
  raw: jest.fn(),
  fn: { now: jest.fn() },
}));
jest.mock('../../services/infra/authService', () => ({
  authenticate: jest.fn((req, _res, next) => { req.user = { user_id: 'user-1' }; next(); }),
}));
jest.mock('../../services/move/distanceService', () => ({
  calculateDrivingDistance: jest.fn(),
}));
jest.mock('../../services/move/moveQueryService', () => ({}));
jest.mock('../../services/move/moveMutationService', () => ({}));

const request = require('supertest');
const express = require('express');
const { TRUCK_SIZES, recommendTruckSize } = require('../../services/move/trucksService');
const router = require('../../routes/api/move/moves');

const BASE = '/api/move';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(BASE, router);
  return app;
}

const VALID_BODY = {
  distanceMiles: 1200,
  totalWeightLbs: 5400,
  totalVolumeCuFt: 620,
  itemCount: 140,
  originCity: 'Denver',
  destinationCity: 'Austin',
};

describe('POST /api/move/estimate — combined server cost engine', () => {
  test('valid request returns truck + cost + labor shapes', async () => {
    const res = await request(makeApp()).post(`${BASE}/estimate`).send(VALID_BODY);

    expect(res.status).toBe(200);

    // Echoed inputs
    expect(res.body.inputs).toEqual({
      distanceMiles: 1200,
      totalWeightLbs: 5400,
      totalVolumeCuFt: 620,
      itemCount: 140,
      originCity: 'Denver',
      destinationCity: 'Austin',
    });

    // Truck recommendation (trucksService shape)
    const { truck } = res.body;
    expect(truck.success).toBe(true);
    expect(truck.recommendation).toEqual(expect.objectContaining({
      size: expect.any(String),
      code: expect.any(String),
      capacityCuFt: expect.any(Number),
      maxWeightLbs: expect.any(Number),
      volumeUtilization: expect.any(Number),
      weightUtilization: expect.any(Number),
    }));
    expect(typeof truck.needsMultipleLoads).toBe('boolean');

    // Cost estimate (moveCostService shape)
    const { cost } = res.body;
    expect(cost.success).toBe(true);
    expect(cost.moveType).toBe('long_distance'); // 1200 mi > 50 mi
    expect(cost.diy).toEqual(expect.objectContaining({
      low: expect.any(Number),
      high: expect.any(Number),
      truckSize: expect.any(String),
    }));
    expect(cost.professional).toEqual(expect.objectContaining({
      low: expect.any(Number),
      high: expect.any(Number),
      movers: expect.any(Number),
    }));
    expect(cost.diy.low).toBeGreaterThan(0);
    expect(cost.diy.high).toBeGreaterThanOrEqual(cost.diy.low);
    expect(cost.professional.high).toBeGreaterThanOrEqual(cost.professional.low);

    // Labor estimate (laborEstimationService shape)
    const { labor } = res.body;
    expect(labor.success).toBe(true);
    expect(labor).toEqual(expect.objectContaining({
      loadingHours: expect.any(Number),
      unloadingHours: expect.any(Number),
      totalLaborHours: expect.any(Number),
      laborCostEstimate: expect.any(Number),
      recommendedMovers: expect.any(Number),
    }));
    expect(labor.totalLaborHours).toBeCloseTo(labor.loadingHours + labor.unloadingHours, 5);
  });

  test('itemCount / cities are optional', async () => {
    const res = await request(makeApp()).post(`${BASE}/estimate`).send({
      distanceMiles: 10,
      totalWeightLbs: 800,
      totalVolumeCuFt: 120,
    });
    expect(res.status).toBe(200);
    expect(res.body.inputs.itemCount).toBe(0);
    expect(res.body.inputs.originCity).toBeNull();
    expect(res.body.cost.moveType).toBe('local');
  });

  describe('validation — 400 on garbage', () => {
    const cases = [
      ['empty body', {}],
      ['missing distance', { totalWeightLbs: 100, totalVolumeCuFt: 50 }],
      ['non-numeric weight', { distanceMiles: 10, totalWeightLbs: 'heavy', totalVolumeCuFt: 50 }],
      ['NaN volume', { distanceMiles: 10, totalWeightLbs: 100, totalVolumeCuFt: NaN }],
      ['negative distance', { distanceMiles: -5, totalWeightLbs: 100, totalVolumeCuFt: 50 }],
      ['absurd distance', { distanceMiles: 900000, totalWeightLbs: 100, totalVolumeCuFt: 50 }],
      ['absurd weight', { distanceMiles: 10, totalWeightLbs: 9e9, totalVolumeCuFt: 50 }],
      ['garbage itemCount', { distanceMiles: 10, totalWeightLbs: 100, totalVolumeCuFt: 50, itemCount: 'lots' }],
    ];

    test.each(cases)('%s', async (_label, body) => {
      const res = await request(makeApp()).post(`${BASE}/estimate`).send(body);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid estimate request');
      expect(Array.isArray(res.body.details)).toBe(true);
      expect(res.body.details.length).toBeGreaterThan(0);
    });
  });

  test('truck tier matches trucksService for a known volume', async () => {
    // 500 cu ft * 1.2 buffer = 600 -> smallest truck with >= 600 cu ft and
    // >= 4000 lbs capacity is the 15-ft (700 cu ft / 6000 lbs).
    const totals = {
      totalVolumeCuFt: 500,
      totalWeight: 4000,
      totalItems: 0,
      missingWeight: 0,
      missingDimensions: 0,
    };
    const expected = recommendTruckSize(totals);
    expect(expected.recommendation.code).toBe('15ft');

    const res = await request(makeApp()).post(`${BASE}/estimate`).send({
      distanceMiles: 100,
      totalWeightLbs: 4000,
      totalVolumeCuFt: 500,
    });

    expect(res.status).toBe(200);
    expect(res.body.truck).toEqual(expected);
    expect(res.body.truck.recommendation.size).toBe('15-ft Truck');
    // And the recommended tier really is one of the service's fixed tiers
    expect(TRUCK_SIZES.map(t => t.code)).toContain(res.body.truck.recommendation.code);
  });

  test('sits behind the router-level authenticate middleware like its siblings', async () => {
    const auth = require('../../services/infra/authService');
    auth.authenticate.mockClear();
    await request(makeApp()).post(`${BASE}/estimate`).send(VALID_BODY);
    expect(auth.authenticate).toHaveBeenCalledTimes(1);
  });
});
