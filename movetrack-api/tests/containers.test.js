/**
 * Containers API Integration Tests
 *
 * Tests for the /containers endpoints including:
 * - Creating containers with new Nexus Moves fields
 * - Retrieving containers
 * - Updating containers
 * - Testing sealed/unsealed functionality
 * - Testing all new fields (box_number, box_type, sealed, weight_lbs, fragile_contents, qr_code, color_code)
 */

const request = require('supertest');
const app = require('../app');
const {
  initTestDb,
  cleanDatabase,
  createTestUser,
  createTestCollection,
  createTestLocation,
  createTestContainer,
  closeTestDb
} = require('./setup');

describe('Containers API', () => {
  let testCollection;
  let testLocation;

  beforeAll(async () => {
    initTestDb();
  });

  beforeEach(async () => {
    await cleanDatabase();
    await createTestUser('testuser', 'test@movetrack.com');
    testCollection = await createTestCollection('testuser', 'Test Collection');
    testLocation = await createTestLocation('testuser', 'Test Home');
  });

  afterAll(async () => {
    await closeTestDb();
  });

  describe('POST /containers/post', () => {
    it('should create a basic container with minimal fields', async () => {
      const response = await request(app)
        .post('/containers/post')
        .query({
          user: 'testuser',
          name: 'Box 1',
          description: 'A test box',
          collection: testCollection.id
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      expect(response.body[0]).toHaveProperty('id');
    });

    it('should create a container with all new Nexus Moves fields', async () => {
      const response = await request(app)
        .post('/containers/post')
        .query({
          user: 'testuser',
          name: 'Kitchen Box',
          description: 'Kitchen items',
          collection: testCollection.id,
          location_id: testLocation.id,
          box_number: 'BOX-KITCHEN-001',
          box_type: 'large',
          sealed: true,
          weight_lbs: 25.5,
          fragile_contents: true,
          qr_code: 'QR12345',
          color_code: 'yellow'
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);

      // Verify all fields were saved
      const db = require('./setup').getTestDb();
      const container = await db('containers')
        .where({ id: response.body[0].id })
        .first();

      expect(container.name).toBe('Kitchen Box');
      expect(container.box_number).toBe('BOX-KITCHEN-001');
      expect(container.box_type).toBe('large');
      expect(container.sealed).toBe(true);
      expect(parseFloat(container.weight_lbs)).toBe(25.5);
      expect(container.fragile_contents).toBe(true);
      expect(container.qr_code).toBe('QR12345');
      expect(container.color_code).toBe('yellow');
      expect(container.sealed_at).toBeTruthy(); // Should be set when sealed is true
    });

    it('should handle sealed flag correctly (boolean conversion)', async () => {
      const response1 = await request(app)
        .post('/containers/post')
        .query({
          user: 'testuser',
          name: 'Sealed Box',
          collection: testCollection.id,
          sealed: 'true'
        });

      const response2 = await request(app)
        .post('/containers/post')
        .query({
          user: 'testuser',
          name: 'Open Box',
          collection: testCollection.id,
          sealed: 'false'
        });

      expect(response1.status).toBe(200);
      expect(response2.status).toBe(200);

      const db = require('./setup').getTestDb();
      const container1 = await db('containers').where({ id: response1.body[0].id }).first();
      const container2 = await db('containers').where({ id: response2.body[0].id }).first();

      expect(container1.sealed).toBe(true);
      expect(container2.sealed).toBe(false);
    });

    it('should handle fragile_contents flag correctly', async () => {
      const response = await request(app)
        .post('/containers/post')
        .query({
          user: 'testuser',
          name: 'Fragile Box',
          collection: testCollection.id,
          fragile_contents: true
        });

      expect(response.status).toBe(200);

      const db = require('./setup').getTestDb();
      const container = await db('containers').where({ id: response.body[0].id }).first();
      expect(container.fragile_contents).toBe(true);
    });

    it('should handle different box types', async () => {
      const boxTypes = ['small', 'medium', 'large', 'wardrobe', 'custom'];

      for (const boxType of boxTypes) {
        const response = await request(app)
          .post('/containers/post')
          .query({
            user: 'testuser',
            name: `${boxType} box`,
            collection: testCollection.id,
            box_type: boxType
          });

        expect(response.status).toBe(200);

        const db = require('./setup').getTestDb();
        const container = await db('containers').where({ id: response.body[0].id }).first();
        expect(container.box_type).toBe(boxType);
      }
    });
  });

  describe('PUT /containers/update', () => {
    it('should update container with new Nexus Moves fields', async () => {
      const container = await createTestContainer('testuser', testCollection.id, testLocation.id);

      const response = await request(app)
        .put('/containers/update')
        .query({
          container_id: container.id,
          name: 'Updated Box Name',
          box_number: 'BOX-999',
          box_type: 'small',
          sealed: false,
          weight_lbs: 15.0,
          fragile_contents: false,
          color_code: 'blue'
        });

      expect(response.status).toBe(200);

      // Verify the update
      const db = require('./setup').getTestDb();
      const updated = await db('containers').where({ id: container.id }).first();

      expect(updated.name).toBe('Updated Box Name');
      expect(updated.box_number).toBe('BOX-999');
      expect(updated.box_type).toBe('small');
      expect(updated.sealed).toBe(false);
      expect(parseFloat(updated.weight_lbs)).toBe(15.0);
      expect(updated.fragile_contents).toBe(false);
      expect(updated.color_code).toBe('blue');
    });

    it('should set sealed_at timestamp when sealing a box', async () => {
      const container = await createTestContainer('testuser', testCollection.id, testLocation.id);

      // Initially unsealed
      expect(container.sealed).toBe(false);

      // Seal the box
      const response = await request(app)
        .put('/containers/update')
        .query({
          container_id: container.id,
          sealed: true
        });

      expect(response.status).toBe(200);

      const db = require('./setup').getTestDb();
      const updated = await db('containers').where({ id: container.id }).first();

      expect(updated.sealed).toBe(true);
      expect(updated.sealed_at).toBeTruthy();
      expect(new Date(updated.sealed_at)).toBeInstanceOf(Date);
    });

    it('should allow partial updates', async () => {
      const container = await createTestContainer('testuser', testCollection.id, testLocation.id);

      const response = await request(app)
        .put('/containers/update')
        .query({
          container_id: container.id,
          color_code: 'red'
        });

      expect(response.status).toBe(200);

      const db = require('./setup').getTestDb();
      const updated = await db('containers').where({ id: container.id }).first();

      expect(updated.color_code).toBe('red');
      // Original fields should remain
      expect(updated.box_number).toBe('BOX-001');
    });
  });

  describe('GET /containers/single', () => {
    it('should retrieve container with all Nexus Moves fields', async () => {
      const container = await createTestContainer('testuser', testCollection.id, testLocation.id);

      const response = await request(app)
        .get('/containers/single')
        .query({
          user: 'testuser',
          container: container.id
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);

      const retrievedContainer = response.body[0];
      expect(retrievedContainer.name).toBe('Test Box 1');
      expect(retrievedContainer.box_number).toBe('BOX-001');
      expect(retrievedContainer.box_type).toBe('medium');
      expect(retrievedContainer.sealed).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('should handle heavy containers', async () => {
      const response = await request(app)
        .post('/containers/post')
        .query({
          user: 'testuser',
          name: 'Heavy Box',
          collection: testCollection.id,
          weight_lbs: 999.99
        });

      expect(response.status).toBe(200);

      const db = require('./setup').getTestDb();
      const container = await db('containers').where({ id: response.body[0].id }).first();
      expect(parseFloat(container.weight_lbs)).toBe(999.99);
    });

    it('should handle custom box numbers with special characters', async () => {
      const response = await request(app)
        .post('/containers/post')
        .query({
          user: 'testuser',
          name: 'Special Box',
          collection: testCollection.id,
          box_number: 'BOX-KITCHEN-#3-2024'
        });

      expect(response.status).toBe(200);

      const db = require('./setup').getTestDb();
      const container = await db('containers').where({ id: response.body[0].id }).first();
      expect(container.box_number).toBe('BOX-KITCHEN-#3-2024');
    });

    it('should handle QR code values', async () => {
      const response = await request(app)
        .post('/containers/post')
        .query({
          user: 'testuser',
          name: 'QR Box',
          collection: testCollection.id,
          qr_code: 'https://movetrack.app/box/abc123'
        });

      expect(response.status).toBe(200);

      const db = require('./setup').getTestDb();
      const container = await db('containers').where({ id: response.body[0].id }).first();
      expect(container.qr_code).toBe('https://movetrack.app/box/abc123');
    });
  });
});
