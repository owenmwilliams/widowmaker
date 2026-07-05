/**
 * Test Setup and Database Helper Functions
 *
 * This file provides utilities for setting up and tearing down test databases,
 * creating test fixtures, and cleaning up after tests.
 */

const knex = require('knex');

// Test database configuration
const testDbConfig = {
  client: 'pg',
  connection: {
    host: process.env.MT_DATALAYER_HOSTNAME || 'localhost',
    port: process.env.MT_DATALAYER_PORT || 5432,
    user: process.env.MT_DATALAYER_USERNAME || 'movetrack_user',
    password: process.env.MT_DATALAYER_PASSWORD || 'changeme123',
    database: process.env.MT_DATALAYER_DATABASE || 'movetrack_test_db'
  }
};

let testDb;

/**
 * Initialize test database connection
 */
function initTestDb() {
  testDb = knex(testDbConfig);
  return testDb;
}

/**
 * Clean up all test data from database
 */
async function cleanDatabase() {
  if (!testDb) return;

  await testDb.raw('TRUNCATE TABLE item_history CASCADE');
  await testDb.raw('TRUNCATE TABLE permissions CASCADE');
  await testDb.raw('TRUNCATE TABLE items CASCADE');
  await testDb.raw('TRUNCATE TABLE containers CASCADE');
  await testDb.raw('TRUNCATE TABLE collections CASCADE');
  await testDb.raw('TRUNCATE TABLE locations CASCADE');
  await testDb.raw('TRUNCATE TABLE users CASCADE');
}

/**
 * Create test user
 */
async function createTestUser(username = 'testuser', email = 'test@movetrack.com') {
  const result = await testDb('users')
    .insert({
      user_name: username,
      first_name: 'Test',
      last_name: 'User',
      email: email
    })
    .returning('*');
  return result[0];
}

/**
 * Create test location
 */
async function createTestLocation(owner = 'testuser', name = 'Test Home') {
  const result = await testDb('locations')
    .insert({
      owner: owner,
      name: name,
      location_type: 'residence',
      address: '123 Test St',
      city: 'Test City',
      state: 'CA',
      zip: '12345'
    })
    .returning('*');
  return result[0];
}

/**
 * Create test collection with permissions
 */
async function createTestCollection(owner = 'testuser', name = 'Test Collection') {
  return await testDb.transaction(async (trx) => {
    const collection = await trx('collections')
      .insert({
        owner: owner,
        name: name,
        description: 'Test collection description'
      })
      .returning('*');

    await trx('permissions')
      .insert({
        user_name: owner,
        id: collection[0].id,
        type: 'collection',
        permission_level: 'owner',
        granted_by: owner
      });

    return collection[0];
  });
}

/**
 * Create test container
 */
async function createTestContainer(owner = 'testuser', collectionId, locationId) {
  const result = await testDb('containers')
    .insert({
      owner: owner,
      name: 'Test Box 1',
      collection_id: collectionId,
      location_id: locationId,
      description: 'Test container',
      box_number: 'BOX-001',
      box_type: 'medium',
      sealed: false
    })
    .returning('*');
  return result[0];
}

/**
 * Create test item with all Nexus Moves fields
 */
async function createTestItem(owner = 'testuser', collectionId, containerId = null) {
  return await testDb.transaction(async (trx) => {
    const item = await trx('items')
      .insert({
        owner: owner,
        name: 'Test Item',
        collection_id: collectionId,
        container_id: containerId,
        description: 'Test item description',
        quantity: 1,
        estimated_value: 99.99,
        fragile: true,
        priority: 'high',
        weight_lbs: 5.5,
        dimensions: '12x8x6',
        notes: 'Test notes'
      })
      .returning('*');

    await trx('permissions')
      .insert({
        user_name: owner,
        id: item[0].id,
        type: 'item',
        permission_level: 'owner',
        granted_by: owner
      });

    return item[0];
  });
}

/**
 * Close database connection
 */
async function closeTestDb() {
  if (testDb) {
    await testDb.destroy();
    testDb = null;
  }
}

module.exports = {
  initTestDb,
  cleanDatabase,
  createTestUser,
  createTestLocation,
  createTestCollection,
  createTestContainer,
  createTestItem,
  closeTestDb,
  getTestDb: () => testDb
};
