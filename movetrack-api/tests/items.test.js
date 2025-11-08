/**
 * Items API Integration Tests
 *
 * Tests for the /items endpoints including:
 * - Creating items with new MoveTrack fields
 * - Retrieving items
 * - Updating items
 * - Deleting items
 * - Testing all new fields (estimated_value, fragile, priority, weight_lbs, dimensions, notes)
 */

const request = require('supertest');
const app = require('../app');
const {
  initTestDb,
  cleanDatabase,
  createTestUser,
  createTestCollection,
  createTestContainer,
  createTestLocation,
  createTestItem,
  closeTestDb
} = require('./setup');

describe('Items API', () => {
  let testCollection;
  let testContainer;
  let testLocation;

  beforeAll(async () => {
    initTestDb();
  });

  beforeEach(async () => {
    await cleanDatabase();
    await createTestUser('testuser', 'test@movetrack.com');
    testCollection = await createTestCollection('testuser', 'Test Collection');
    testLocation = await createTestLocation('testuser', 'Test Home');
    testContainer = await createTestContainer('testuser', testCollection.id, testLocation.id);
  });

  afterAll(async () => {
    await closeTestDb();
  });

  describe('POST /items/post', () => {
    it('should create a basic item with minimal fields', async () => {
      const response = await request(app)
        .post('/items/post')
        .query({
          user: 'testuser',
          name: 'Test Item',
          description: 'A test item',
          quantity: 1,
          collection: testCollection.id
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      expect(response.body[0]).toHaveProperty('id');
    });

    it('should create an item with all new MoveTrack fields', async () => {
      const response = await request(app)
        .post('/items/post')
        .query({
          user: 'testuser',
          name: 'Expensive Vase',
          description: 'Antique vase',
          quantity: 1,
          collection: testCollection.id,
          container: testContainer.id,
          estimated_value: 250.50,
          fragile: true,
          priority: 'high',
          weight_lbs: 3.5,
          dimensions: '10x10x14',
          notes: 'Handle with extreme care!'
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);

      // Verify all fields were saved
      const db = require('./setup').getTestDb();
      const item = await db('items')
        .where({ id: response.body[0].id })
        .first();

      expect(item.name).toBe('Expensive Vase');
      expect(parseFloat(item.estimated_value)).toBe(250.50);
      expect(item.fragile).toBe(true);
      expect(item.priority).toBe('high');
      expect(parseFloat(item.weight_lbs)).toBe(3.5);
      expect(item.dimensions).toBe('10x10x14');
      expect(item.notes).toBe('Handle with extreme care!');
    });

    it('should create item with granted_by field in permissions', async () => {
      const response = await request(app)
        .post('/items/post')
        .query({
          user: 'testuser',
          name: 'Test Item',
          description: 'Test',
          quantity: 1,
          collection: testCollection.id
        });

      expect(response.status).toBe(200);

      // Verify permission was created with granted_by
      const db = require('./setup').getTestDb();
      const permissions = await db('permissions')
        .where({
          user_name: 'testuser',
          id: response.body[0].id,
          type: 'item'
        })
        .first();

      expect(permissions).toBeTruthy();
      expect(permissions.granted_by).toBe('testuser');
      expect(permissions.permission_level).toBe('owner');
    });

    it('should handle fragile flag correctly (boolean conversion)', async () => {
      const response1 = await request(app)
        .post('/items/post')
        .query({
          user: 'testuser',
          name: 'Fragile Item',
          quantity: 1,
          collection: testCollection.id,
          fragile: 'true'
        });

      const response2 = await request(app)
        .post('/items/post')
        .query({
          user: 'testuser',
          name: 'Not Fragile Item',
          quantity: 1,
          collection: testCollection.id,
          fragile: 'false'
        });

      expect(response1.status).toBe(200);
      expect(response2.status).toBe(200);

      const db = require('./setup').getTestDb();
      const item1 = await db('items').where({ id: response1.body[0].id }).first();
      const item2 = await db('items').where({ id: response2.body[0].id }).first();

      expect(item1.fragile).toBe(true);
      expect(item2.fragile).toBe(false);
    });

    it('should handle different priority levels', async () => {
      const priorities = ['low', 'normal', 'high'];

      for (const priority of priorities) {
        const response = await request(app)
          .post('/items/post')
          .query({
            user: 'testuser',
            name: `${priority} priority item`,
            quantity: 1,
            collection: testCollection.id,
            priority: priority
          });

        expect(response.status).toBe(200);

        const db = require('./setup').getTestDb();
        const item = await db('items').where({ id: response.body[0].id }).first();
        expect(item.priority).toBe(priority);
      }
    });
  });

  describe('PUT /items/update', () => {
    it('should update item with new MoveTrack fields', async () => {
      const item = await createTestItem('testuser', testCollection.id);

      const response = await request(app)
        .put('/items/update')
        .query({
          item_id: item.id,
          name: 'Updated Item Name',
          estimated_value: 500.00,
          fragile: false,
          priority: 'low',
          weight_lbs: 10.5,
          dimensions: '20x15x10',
          notes: 'Updated notes'
        });

      expect(response.status).toBe(200);

      // Verify the update
      const db = require('./setup').getTestDb();
      const updated = await db('items').where({ id: item.id }).first();

      expect(updated.name).toBe('Updated Item Name');
      expect(parseFloat(updated.estimated_value)).toBe(500.00);
      expect(updated.fragile).toBe(false);
      expect(updated.priority).toBe('low');
      expect(parseFloat(updated.weight_lbs)).toBe(10.5);
      expect(updated.dimensions).toBe('20x15x10');
      expect(updated.notes).toBe('Updated notes');
    });

    it('should allow partial updates', async () => {
      const item = await createTestItem('testuser', testCollection.id);

      const response = await request(app)
        .put('/items/update')
        .query({
          item_id: item.id,
          name: 'Partially Updated',
          priority: 'high'
        });

      expect(response.status).toBe(200);

      const db = require('./setup').getTestDb();
      const updated = await db('items').where({ id: item.id }).first();

      expect(updated.name).toBe('Partially Updated');
      expect(updated.priority).toBe('high');
      // Original fields should remain
      expect(parseFloat(updated.estimated_value)).toBe(99.99);
    });
  });

  describe('GET /items/single', () => {
    it('should retrieve item with all MoveTrack fields', async () => {
      const item = await createTestItem('testuser', testCollection.id);

      const response = await request(app)
        .get('/items/single')
        .query({
          user: 'testuser',
          item: item.id
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);

      const retrievedItem = response.body[0];
      expect(retrievedItem.name).toBe('Test Item');
      expect(parseFloat(retrievedItem.estimated_value)).toBe(99.99);
      expect(retrievedItem.fragile).toBe(true);
      expect(retrievedItem.priority).toBe('high');
      expect(parseFloat(retrievedItem.weight_lbs)).toBe(5.5);
      expect(retrievedItem.dimensions).toBe('12x8x6');
      expect(retrievedItem.notes).toBe('Test notes');
    });
  });

  describe('DELETE /items/delete', () => {
    it('should delete an item', async () => {
      const item = await createTestItem('testuser', testCollection.id);

      const response = await request(app)
        .delete('/items/delete')
        .query({
          item_id: item.id
        });

      expect(response.status).toBe(200);

      // Verify deletion
      const db = require('./setup').getTestDb();
      const deleted = await db('items').where({ id: item.id }).first();
      expect(deleted).toBeUndefined();
    });
  });

  describe('Edge Cases', () => {
    it('should handle large estimated values', async () => {
      const response = await request(app)
        .post('/items/post')
        .query({
          user: 'testuser',
          name: 'Expensive Item',
          quantity: 1,
          collection: testCollection.id,
          estimated_value: 999999.99
        });

      expect(response.status).toBe(200);

      const db = require('./setup').getTestDb();
      const item = await db('items').where({ id: response.body[0].id }).first();
      expect(parseFloat(item.estimated_value)).toBe(999999.99);
    });

    it('should handle empty notes field', async () => {
      const response = await request(app)
        .post('/items/post')
        .query({
          user: 'testuser',
          name: 'Item with no notes',
          quantity: 1,
          collection: testCollection.id,
          notes: ''
        });

      expect(response.status).toBe(200);
    });

    it('should handle special characters in dimensions', async () => {
      const response = await request(app)
        .post('/items/post')
        .query({
          user: 'testuser',
          name: 'Odd dimensions',
          quantity: 1,
          collection: testCollection.id,
          dimensions: '12.5" x 8.25" x 6"'
        });

      expect(response.status).toBe(200);

      const db = require('./setup').getTestDb();
      const item = await db('items').where({ id: response.body[0].id }).first();
      expect(item.dimensions).toBe('12.5" x 8.25" x 6"');
    });
  });
});
