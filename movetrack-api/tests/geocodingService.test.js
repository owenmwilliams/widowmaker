/**
 * Unit tests for the Geocoding Service
 *
 * Tests the pure functions for address parsing and cache key generation
 * without making actual API calls
 */

const { parseAddressComponents, getCacheKey, clearCache, getCacheStats } = require('../services/infra/geocodingService');

describe('Geocoding Service', () => {
  describe('getCacheKey', () => {
    it('should round coordinates to 4 decimal places', () => {
      const key = getCacheKey(37.7749295, -122.4194155);
      expect(key).toBe('37.7749,-122.4194');
    });

    it('should handle whole number coordinates', () => {
      const key = getCacheKey(40, -100);
      expect(key).toBe('40,-100');
    });

    it('should handle negative coordinates', () => {
      const key = getCacheKey(-33.8688, 151.2093);
      expect(key).toBe('-33.8688,151.2093');
    });

    it('should produce same key for nearby coordinates', () => {
      // These coordinates are ~11 meters apart (within rounding)
      const key1 = getCacheKey(37.77490, -122.41940);
      const key2 = getCacheKey(37.77491, -122.41941);
      expect(key1).toBe(key2);
    });
  });

  describe('parseAddressComponents', () => {
    it('should extract city from locality type', () => {
      const results = [{
        address_components: [
          { long_name: 'San Francisco', short_name: 'SF', types: ['locality', 'political'] },
          { long_name: 'California', short_name: 'CA', types: ['administrative_area_level_1', 'political'] },
          { long_name: 'United States', short_name: 'US', types: ['country', 'political'] }
        ]
      }];

      const parsed = parseAddressComponents(results);
      expect(parsed.city).toBe('San Francisco');
      expect(parsed.state).toBe('CA');
      expect(parsed.country).toBe('US');
    });

    it('should fall back to sublocality when locality is not available', () => {
      const results = [{
        address_components: [
          { long_name: 'Manhattan', short_name: 'Manhattan', types: ['sublocality_level_1', 'sublocality', 'political'] },
          { long_name: 'New York', short_name: 'NY', types: ['administrative_area_level_1', 'political'] }
        ]
      }];

      const parsed = parseAddressComponents(results);
      expect(parsed.city).toBe('Manhattan');
      expect(parsed.state).toBe('NY');
    });

    it('should fall back to administrative_area_level_3 (township)', () => {
      const results = [{
        address_components: [
          { long_name: 'Springfield Township', short_name: 'Springfield Township', types: ['administrative_area_level_3', 'political'] },
          { long_name: 'Pennsylvania', short_name: 'PA', types: ['administrative_area_level_1', 'political'] }
        ]
      }];

      const parsed = parseAddressComponents(results);
      expect(parsed.city).toBe('Springfield Township');
      expect(parsed.state).toBe('PA');
    });

    it('should fall back to county (administrative_area_level_2) as last resort', () => {
      const results = [{
        address_components: [
          { long_name: 'Some County', short_name: 'Some County', types: ['administrative_area_level_2', 'political'] },
          { long_name: 'Texas', short_name: 'TX', types: ['administrative_area_level_1', 'political'] }
        ]
      }];

      const parsed = parseAddressComponents(results);
      expect(parsed.city).toBe('Some County');
      expect(parsed.state).toBe('TX');
    });

    it('should handle empty results', () => {
      const parsed = parseAddressComponents([]);
      expect(parsed.city).toBeNull();
      expect(parsed.state).toBeNull();
      expect(parsed.country).toBeNull();
    });

    it('should handle results without address_components', () => {
      const results = [{ formatted_address: 'Some Address' }];
      const parsed = parseAddressComponents(results);
      expect(parsed.city).toBeNull();
    });

    it('should find locality regardless of order in components (Google API returns locality first)', () => {
      // Google API typically returns locality before other administrative areas
      const results = [{
        address_components: [
          { long_name: 'Portland', short_name: 'Portland', types: ['locality', 'political'] },
          { long_name: 'Multnomah County', short_name: 'Multnomah County', types: ['administrative_area_level_2', 'political'] },
          { long_name: 'Oregon', short_name: 'OR', types: ['administrative_area_level_1', 'political'] }
        ]
      }];

      const parsed = parseAddressComponents(results);
      expect(parsed.city).toBe('Portland');
      expect(parsed.state).toBe('OR');
    });

    it('should look through multiple results to find city', () => {
      const results = [
        {
          address_components: [
            { long_name: 'Street Address', short_name: 'St', types: ['route'] }
          ]
        },
        {
          address_components: [
            { long_name: 'Denver', short_name: 'Denver', types: ['locality', 'political'] },
            { long_name: 'Colorado', short_name: 'CO', types: ['administrative_area_level_1', 'political'] }
          ]
        }
      ];

      const parsed = parseAddressComponents(results);
      expect(parsed.city).toBe('Denver');
      expect(parsed.state).toBe('CO');
    });
  });

  describe('Cache functions', () => {
    beforeEach(() => {
      clearCache();
    });

    it('should start with empty cache', () => {
      const stats = getCacheStats();
      expect(stats.totalEntries).toBe(0);
    });

    it('should clear cache', () => {
      // Note: We can't easily add to cache without making API calls
      // This just verifies clearCache doesn't throw
      clearCache();
      const stats = getCacheStats();
      expect(stats.totalEntries).toBe(0);
    });
  });
});
