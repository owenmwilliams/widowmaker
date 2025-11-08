/**
 * Collections API Integration Tests
 *
 * Tests for the /collections endpoints including:
 * - Creating collections
 * - Retrieving collections
 * - Updating collections
 * - Deleting collections
 * - Permissions handling
 */

const request = require('supertest');
const app = require('../app');
const {
  initTestDb,
  cleanDatabase,
  createTestUser,
  createTestCollection,
  closeTestDb
} = require('./setup');

describe('Collections API', () => {
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

  describe('POST /collections/post', () => {
    it('should create a new collection with permissions', async () => {
      const response = await request(app)
        .post('/collections/post')
        .query({
          user: 'testuser',
          name: 'Living Room',
          description: 'Living room items'
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      expect(response.body[0]).toHaveProperty('id');
    });

    it('should fail when user parameter is missing', async () => {
      const response = await request(app)
        .post('/collections/post')
        .query({
          name: 'Living Room',
          description: 'Living room items'
        });

      expect(response.status).toBe(500);
    });

    it('should create collection with granted_by field in permissions', async () => {
      const response = await request(app)
        .post('/collections/post')
        .query({
          user: 'testuser',
          name: 'Kitchen',
          description: 'Kitchen stuff'
        });

      expect(response.status).toBe(200);

      // Verify permission was created with granted_by
      const db = require('./setup').getTestDb();
      const permissions = await db('permissions')
        .where({
          user_name: 'testuser',
          id: response.body[0].id,
          type: 'collection'
        })
        .first();

      expect(permissions).toBeTruthy();
      expect(permissions.granted_by).toBe('testuser');
      expect(permissions.permission_level).toBe('owner');
    });

    it('should handle special characters in collection name', async () => {
      const response = await request(app)
        .post('/collections/post')
        .query({
          user: 'testuser',
          name: "Mom's Collection #1 (2024)",
          description: 'Special chars test'
        });

      expect(response.status).toBe(200);
    });
  });

  describe('PUT /collections/update', () => {
    it('should update an existing collection', async () => {
      // Create a collection first
      const collection = await createTestCollection('testuser', 'Old Name');

      const response = await request(app)
        .put('/collections/update')
        .query({
          user: 'testuser',
          collection_id: collection.id,
          name: 'New Name',
          description: 'Updated description'
        });

      expect(response.status).toBe(200);
      expect(response.text).toBe('OK');

      // Verify the update
      const db = require('./setup').getTestDb();
      const updated = await db('collections')
        .where({ id: collection.id })
        .first();

      expect(updated.name).toBe('New Name');
      expect(updated.description).toBe('Updated description');
    });

    it('should fail when collection_id is missing', async () => {
      const response = await request(app)
        .put('/collections/update')
        .query({
          user: 'testuser',
          name: 'New Name'
        });

      expect(response.status).toBe(500);
    });
  });

  describe('DELETE /collections/delete', () => {
    it('should delete a collection and cascade to items and containers', async () => {
      const db = require('./setup').getTestDb();
      const collection = await createTestCollection('testuser', 'To Delete');

      // Create a container and item in this collection
      await db('containers').insert({
        owner: 'testuser',
        name: 'Box 1',
        collection_id: collection.id
      });

      await db('items').insert({
        owner: 'testuser',
        name: 'Item 1',
        collection_id: collection.id
      });

      const response = await request(app)
        .delete('/collections/delete')
        .query({
          collection_id: collection.id
        });

      expect(response.status).toBe(200);
      expect(response.text).toBe('OK');

      // Verify collection is deleted
      const deletedCollection = await db('collections')
        .where({ id: collection.id })
        .first();
      expect(deletedCollection).toBeUndefined();

      // Verify items are deleted
      const items = await db('items')
        .where({ collection_id: collection.id });
      expect(items).toHaveLength(0);

      // Verify containers are deleted
      const containers = await db('containers')
        .where({ collection_id: collection.id });
      expect(containers).toHaveLength(0);
    });
  });

  describe('GET /collections/all', () => {
    it('should return all collections for a user', async () => {
      await createTestCollection('testuser', 'Collection 1');
      await createTestCollection('testuser', 'Collection 2');
      await createTestCollection('otheruser', 'Other Collection');

      const response = await request(app)
        .get('/collections/all')
        .query({ user: 'testuser' });

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(2);
    });

    it('should return empty array when user has no collections', async () => {
      const response = await request(app)
        .get('/collections/all')
        .query({ user: 'newuser' });

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(0);
    });
  });
});
