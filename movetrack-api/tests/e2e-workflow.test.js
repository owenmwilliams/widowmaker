/**
 * End-to-End Workflow Tests
 *
 * Tests complete user workflows from start to finish:
 * - Complete move preparation workflow
 * - Packing workflow (creating collections, containers, items)
 * - Unpacking workflow
 * - Item search and retrieval
 */

const request = require('supertest');
const app = require('../app');
const {
  initTestDb,
  cleanDatabase,
  createTestUser,
  closeTestDb
} = require('./setup');

describe('End-to-End Workflows', () => {
  beforeAll(async () => {
    initTestDb();
  });

  beforeEach(async () => {
    await cleanDatabase();
    await createTestUser('testuser', 'test@movetrack.com');
  });

  afterAll(async () => {
    await closeTestDb();
  });

  describe('Complete Move Preparation Workflow', () => {
    it('should handle the complete workflow: create collection -> create container -> add items', async () => {
      // Step 1: Create a location
      const locationResponse = await request(app)
        .post('/locations/post')
        .query({
          user: 'testuser',
          name: 'Current Home',
          address: '123 Main St',
          city: 'San Francisco',
          state: 'CA',
          zip: '94105'
        });

      expect(locationResponse.status).toBe(200);
      const locationId = locationResponse.body[0].id;

      // Step 2: Create a collection (Kitchen)
      const collectionResponse = await request(app)
        .post('/collections/post')
        .query({
          user: 'testuser',
          name: 'Kitchen',
          description: 'All kitchen items'
        });

      expect(collectionResponse.status).toBe(200);
      const collectionId = collectionResponse.body[0].id;

      // Step 3: Create a container in the collection
      const containerResponse = await request(app)
        .post('/containers/post')
        .query({
          user: 'testuser',
          name: 'Kitchen Box 1',
          collection: collectionId,
          location_id: locationId,
          box_number: 'KIT-001',
          box_type: 'medium',
          color_code: 'yellow'
        });

      expect(containerResponse.status).toBe(200);
      const containerId = containerResponse.body[0].id;

      // Step 4: Add items to the container
      const item1Response = await request(app)
        .post('/items/post')
        .query({
          user: 'testuser',
          name: 'Dinner Plates Set',
          description: '12 piece dinner plate set',
          quantity: 12,
          collection: collectionId,
          container: containerId,
          estimated_value: 150.00,
          fragile: true,
          priority: 'high',
          weight_lbs: 8.5,
          notes: 'Wrap each plate individually'
        });

      const item2Response = await request(app)
        .post('/items/post')
        .query({
          user: 'testuser',
          name: 'Kitchen Utensils',
          description: 'Spatulas, spoons, etc',
          quantity: 1,
          collection: collectionId,
          container: containerId,
          fragile: false,
          priority: 'normal'
        });

      expect(item1Response.status).toBe(200);
      expect(item2Response.status).toBe(200);

      // Step 5: Seal the container
      const sealResponse = await request(app)
        .put('/containers/update')
        .query({
          container_id: containerId,
          sealed: true,
          weight_lbs: 15.0
        });

      expect(sealResponse.status).toBe(200);

      // Step 6: Verify the sealed container has a timestamp
      const db = require('./setup').getTestDb();
      const sealedContainer = await db('containers')
        .where({ id: containerId })
        .first();

      expect(sealedContainer.sealed).toBe(true);
      expect(sealedContainer.sealed_at).toBeTruthy();

      // Step 7: Verify we can retrieve all items in the collection
      const itemsResponse = await request(app)
        .get('/items/all')
        .query({
          user: 'testuser',
          collection: collectionId
        });

      expect(itemsResponse.status).toBe(200);
      expect(itemsResponse.body.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Multiple Collections Workflow', () => {
    it('should organize items across multiple rooms/collections', async () => {
      // Create multiple collections
      const kitchen = await request(app)
        .post('/collections/post')
        .query({
          user: 'testuser',
          name: 'Kitchen',
          description: 'Kitchen items'
        });

      const bedroom = await request(app)
        .post('/collections/post')
        .query({
          user: 'testuser',
          name: 'Master Bedroom',
          description: 'Bedroom items'
        });

      const garage = await request(app)
        .post('/collections/post')
        .query({
          user: 'testuser',
          name: 'Garage',
          description: 'Garage and tools'
        });

      expect(kitchen.status).toBe(200);
      expect(bedroom.status).toBe(200);
      expect(garage.status).toBe(200);

      // Add items to each collection
      await request(app)
        .post('/items/post')
        .query({
          user: 'testuser',
          name: 'Coffee Maker',
          quantity: 1,
          collection: kitchen.body[0].id,
          estimated_value: 80.00
        });

      await request(app)
        .post('/items/post')
        .query({
          user: 'testuser',
          name: 'Bed Frame',
          quantity: 1,
          collection: bedroom.body[0].id,
          estimated_value: 500.00,
          priority: 'high'
        });

      await request(app)
        .post('/items/post')
        .query({
          user: 'testuser',
          name: 'Power Drill',
          quantity: 1,
          collection: garage.body[0].id,
          estimated_value: 120.00
        });

      // Verify we can get all collections
      const collectionsResponse = await request(app)
        .get('/collections/all')
        .query({ user: 'testuser' });

      expect(collectionsResponse.status).toBe(200);
      expect(collectionsResponse.body).toHaveLength(3);
    });
  });

  describe('High-Value Items Tracking', () => {
    it('should track and identify high-value fragile items', async () => {
      const collection = await request(app)
        .post('/collections/post')
        .query({
          user: 'testuser',
          name: 'Valuables',
          description: 'High value items'
        });

      const collectionId = collection.body[0].id;

      // Add several high-value items
      const highValueItems = [
        { name: 'Antique Vase', value: 2500.00, fragile: true, priority: 'high' },
        { name: 'Oil Painting', value: 5000.00, fragile: true, priority: 'high' },
        { name: 'Crystal Chandelier', value: 3500.00, fragile: true, priority: 'high' },
        { name: 'Laptop', value: 1800.00, fragile: false, priority: 'high' }
      ];

      for (const item of highValueItems) {
        const response = await request(app)
          .post('/items/post')
          .query({
            user: 'testuser',
            name: item.name,
            quantity: 1,
            collection: collectionId,
            estimated_value: item.value,
            fragile: item.fragile,
            priority: item.priority,
            notes: 'High value - special handling required'
          });

        expect(response.status).toBe(200);
      }

      // Verify all items were created
      const db = require('./setup').getTestDb();
      const items = await db('items')
        .where({ collection_id: collectionId })
        .where('estimated_value', '>', 1000);

      expect(items).toHaveLength(4);

      // Count fragile items
      const fragileItems = items.filter(i => i.fragile);
      expect(fragileItems).toHaveLength(3);
    });
  });

  describe('Container Weight Calculation', () => {
    it('should track container weight as items are added', async () => {
      const collection = await request(app)
        .post('/collections/post')
        .query({
          user: 'testuser',
          name: 'Books',
          description: 'Book collection'
        });

      const container = await request(app)
        .post('/containers/post')
        .query({
          user: 'testuser',
          name: 'Book Box',
          collection: collection.body[0].id,
          box_type: 'small'
        });

      const containerId = container.body[0].id;

      // Add items with weights
      await request(app)
        .post('/items/post')
        .query({
          user: 'testuser',
          name: 'Hardcover Books',
          quantity: 10,
          collection: collection.body[0].id,
          container: containerId,
          weight_lbs: 20.0
        });

      await request(app)
        .post('/items/post')
        .query({
          user: 'testuser',
          name: 'Paperback Books',
          quantity: 15,
          collection: collection.body[0].id,
          container: containerId,
          weight_lbs: 12.0
        });

      // Calculate total weight and update container
      const db = require('./setup').getTestDb();
      const items = await db('items')
        .where({ container_id: containerId });

      const totalWeight = items.reduce((sum, item) => sum + parseFloat(item.weight_lbs || 0), 0);

      await request(app)
        .put('/containers/update')
        .query({
          container_id: containerId,
          weight_lbs: totalWeight,
          sealed: true
        });

      const updatedContainer = await db('containers')
        .where({ id: containerId })
        .first();

      expect(parseFloat(updatedContainer.weight_lbs)).toBe(32.0);
      expect(updatedContainer.sealed).toBe(true);
    });
  });
});
