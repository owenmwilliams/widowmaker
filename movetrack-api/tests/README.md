# MoveTrack API Testing Guide

This directory contains comprehensive test suites for the MoveTrack API.

## Test Structure

```
tests/
├── setup.js                 # Test database setup and helper functions
├── collections.test.js      # Collection CRUD operations tests
├── items.test.js           # Item CRUD operations with MoveTrack fields
├── containers.test.js      # Container CRUD operations with MoveTrack fields
└── e2e-workflow.test.js    # End-to-end workflow scenarios
```

## Setup

### 1. Install Dependencies

First, fix the npm cache permission issue:

```bash
sudo chown -R 501:20 "/Users/owenwilliams/.npm"
```

Then install test dependencies:

```bash
cd /Users/owenwilliams/Projects/movetrack/movetrack-api
npm install --save-dev jest supertest @types/jest @types/supertest
```

### 2. Create Test Database

Create a separate test database to avoid affecting your development data:

```bash
# Connect to PostgreSQL
docker exec -it movetrack_pg psql -U movetrack_user -d postgres

# Create test database
CREATE DATABASE movetrack_test_db;

# Exit psql
\q

# Initialize test database schema
docker exec -i movetrack_pg psql -U movetrack_user -d movetrack_test_db < init-movetrack.sql
```

### 3. Set Environment Variables

The tests use these environment variables (defaults to test database):

```bash
export MT_DATALAYER_HOSTNAME=localhost
export MT_DATALAYER_PORT=5432
export MT_DATALAYER_DATABASE=movetrack_test_db
export MT_DATALAYER_USERNAME=movetrack_user
export MT_DATALAYER_PASSWORD=changeme123
```

## Running Tests

### Run all tests
```bash
npm test
```

### Run tests in watch mode (for development)
```bash
npm run test:watch
```

### Run tests with coverage report
```bash
npm run test:coverage
```

### Run specific test file
```bash
npm test -- collections.test.js
npm test -- items.test.js
npm test -- containers.test.js
npm test -- e2e-workflow.test.js
```

### Run tests with verbose output
```bash
npm run test:verbose
```

## Test Coverage

The test suite covers:

### Collections API (`collections.test.js`)
- ✅ Creating collections with permissions
- ✅ Creating collections with `granted_by` field (bug fix verification)
- ✅ Updating collection details
- ✅ Deleting collections (with cascade to items/containers)
- ✅ Retrieving all collections for a user
- ✅ Handling special characters in names
- ✅ Missing parameter validation

### Items API (`items.test.js`)
- ✅ Creating items with basic fields
- ✅ Creating items with all MoveTrack fields:
  - `estimated_value` (decimal)
  - `fragile` (boolean)
  - `priority` (low/normal/high)
  - `weight_lbs` (decimal)
  - `dimensions` (string)
  - `notes` (text)
- ✅ Updating items with new fields
- ✅ Partial updates
- ✅ Retrieving items with all fields
- ✅ Boolean conversion (string to boolean)
- ✅ Edge cases (large values, special characters, empty fields)
- ✅ Permissions with `granted_by` field

### Containers API (`containers.test.js`)
- ✅ Creating containers with basic fields
- ✅ Creating containers with all MoveTrack fields:
  - `box_number` (string)
  - `box_type` (small/medium/large/wardrobe/custom)
  - `sealed` (boolean)
  - `sealed_at` (auto-timestamp)
  - `weight_lbs` (decimal)
  - `fragile_contents` (boolean)
  - `qr_code` (string)
  - `color_code` (string)
- ✅ Updating containers
- ✅ Automatic `sealed_at` timestamp when sealing
- ✅ Retrieving containers with all fields
- ✅ Edge cases (heavy containers, QR codes, special characters)

### End-to-End Workflows (`e2e-workflow.test.js`)
- ✅ Complete move preparation workflow
  - Create location → Create collection → Create container → Add items → Seal container
- ✅ Multiple collections workflow
  - Organizing items across different rooms
- ✅ High-value items tracking
  - Creating and querying valuable/fragile items
- ✅ Container weight calculation
  - Tracking total weight as items are added

## Test Database Helpers

The `setup.js` file provides these helper functions:

### Database Management
- `initTestDb()` - Initialize test database connection
- `cleanDatabase()` - Remove all test data
- `closeTestDb()` - Close database connection

### Test Data Creation
- `createTestUser(username, email)` - Create a test user
- `createTestLocation(owner, name)` - Create a test location
- `createTestCollection(owner, name)` - Create a collection with permissions
- `createTestContainer(owner, collectionId, locationId)` - Create a container
- `createTestItem(owner, collectionId, containerId)` - Create an item with all fields

## Key Test Scenarios

### 1. Permissions Bug Fix Verification
Tests verify that the `granted_by` field is properly included when creating permissions for collections and items (this was the critical bug that crashed the API).

### 2. New MoveTrack Fields
Tests ensure all new fields added during migration are:
- Accepted by POST endpoints
- Properly stored in database
- Returned by GET endpoints
- Updatable via PUT endpoints

### 3. Data Type Conversions
Tests verify proper handling of:
- String to boolean conversions (`fragile`, `sealed`, `fragile_contents`)
- Decimal precision for currency and weight
- Special characters in text fields

### 4. Workflow Integrity
Tests verify complete user workflows work end-to-end without errors.

## Coverage Goals

Current coverage thresholds (in jest.config.js):
- Branches: 50%
- Functions: 50%
- Lines: 50%
- Statements: 50%

To view detailed coverage report:
```bash
npm run test:coverage
open coverage/lcov-report/index.html
```

## Continuous Integration

These tests are designed to run in CI/CD pipelines. Example GitHub Actions workflow:

```yaml
name: Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:14
        env:
          POSTGRES_USER: movetrack_user
          POSTGRES_PASSWORD: changeme123
          POSTGRES_DB: movetrack_test_db
        ports:
          - 5432:5432
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
      - run: npm install
      - run: npm test
```

## Troubleshooting

### Tests hang or timeout
- Increase timeout in jest.config.js
- Ensure PostgreSQL is running
- Check database connection settings

### Database connection errors
- Verify PostgreSQL container is running: `docker ps`
- Check environment variables
- Ensure test database exists

### Permission errors
- Run: `sudo chown -R 501:20 "/Users/owenwilliams/.npm"`
- Clear npm cache: `npm cache clean --force`

## Next Steps

Potential future test additions:
- Frontend component tests (Vue/Quasar)
- Performance tests (load testing)
- Security tests (SQL injection, XSS)
- Integration tests with external services (Google Cloud, Auth0)
- Mobile app tests (Capacitor/native features)
