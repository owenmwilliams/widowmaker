/**
 * Manual API Test Script
 * Run this with: node manual-test.js
 *
 * This tests the API without requiring Jest/Supertest
 */

const http = require('http');

const API_BASE = 'http://localhost:3050';
const TEST_USER = 'testuser_manual';

let testResults = {
  passed: 0,
  failed: 0,
  tests: []
};

// Helper to make HTTP requests
function makeRequest(method, path, callback) {
  const url = new URL(API_BASE + path);
  const options = {
    hostname: url.hostname,
    port: url.port,
    path: url.pathname + url.search,
    method: method
  };

  const req = http.request(options, (res) => {
    let data = '';
    res.on('data', (chunk) => {
      data += chunk;
    });
    res.on('end', () => {
      try {
        const jsonData = JSON.parse(data);
        callback(null, { status: res.statusCode, body: jsonData });
      } catch (e) {
        callback(null, { status: res.statusCode, body: data });
      }
    });
  });

  req.on('error', (e) => {
    callback(e);
  });

  req.end();
}

// Test assertion helper
function assert(testName, condition, message) {
  if (condition) {
    testResults.passed++;
    testResults.tests.push({ name: testName, status: 'PASS', message });
    console.log(`✓ ${testName}: ${message}`);
  } else {
    testResults.failed++;
    testResults.tests.push({ name: testName, status: 'FAIL', message });
    console.log(`✗ ${testName}: ${message}`);
  }
}

// Run tests
async function runTests() {
  console.log('\n🧪 Nexus Moves API Manual Tests\n');
  console.log('Testing API at:', API_BASE);
  console.log('─'.repeat(60));

  // Test 1: Create Collection
  console.log('\n📦 Test 1: Create Collection');
  makeRequest('POST', `/collections/post?user=${TEST_USER}&name=Test%20Collection&description=Manual%20test`, (err, res) => {
    if (err) {
      assert('Create Collection', false, `Error: ${err.message}`);
      return;
    }

    assert('Create Collection - Status', res.status === 200, `Status code is ${res.status}`);
    assert('Create Collection - Response', Array.isArray(res.body) && res.body.length > 0, 'Returns collection ID');

    if (res.body && res.body[0] && res.body[0].id) {
      const collectionId = res.body[0].id;
      console.log(`  Created collection with ID: ${collectionId}`);

      // Test 2: Create Item with Nexus Moves fields
      console.log('\n📦 Test 2: Create Item with Nexus Moves Fields');
      makeRequest('POST', `/items/post?user=${TEST_USER}&name=Test%20Item&description=Test&quantity=1&collection=${collectionId}&estimated_value=99.99&fragile=true&priority=high&weight_lbs=5.5&dimensions=12x8x6&notes=Test%20notes`, (err, res) => {
        if (err) {
          assert('Create Item', false, `Error: ${err.message}`);
          return;
        }

        assert('Create Item - Status', res.status === 200, `Status code is ${res.status}`);
        assert('Create Item - Response', Array.isArray(res.body) && res.body.length > 0, 'Returns item ID');

        if (res.body && res.body[0] && res.body[0].id) {
          const itemId = res.body[0].id;
          console.log(`  Created item with ID: ${itemId}`);

          // Test 3: Retrieve Item with fields
          console.log('\n📦 Test 3: Retrieve Item Details');
          makeRequest('GET', `/items/single?user=${TEST_USER}&item=${itemId}`, (err, res) => {
            if (err) {
              assert('Retrieve Item', false, `Error: ${err.message}`);
              return;
            }

            assert('Retrieve Item - Status', res.status === 200, `Status code is ${res.status}`);
            assert('Retrieve Item - Has Data', Array.isArray(res.body) && res.body.length > 0, 'Returns item data');

            if (res.body && res.body[0]) {
              const item = res.body[0];
              assert('Retrieve Item - Name', item.name === 'Test Item', 'Item name matches');
              assert('Retrieve Item - Estimated Value', parseFloat(item.estimated_value) === 99.99, 'Estimated value is 99.99');
              assert('Retrieve Item - Fragile', item.fragile === true, 'Fragile flag is true');
              assert('Retrieve Item - Priority', item.priority === 'high', 'Priority is high');
              assert('Retrieve Item - Weight', parseFloat(item.weight_lbs) === 5.5, 'Weight is 5.5 lbs');
              assert('Retrieve Item - Dimensions', item.dimensions === '12x8x6', 'Dimensions match');
              assert('Retrieve Item - Notes', item.notes === 'Test notes', 'Notes match');
            }

            // Test 4: Create Container with Nexus Moves fields
            console.log('\n📦 Test 4: Create Container with Nexus Moves Fields');
            makeRequest('POST', `/containers/post?user=${TEST_USER}&name=Test%20Box&description=Test&collection=${collectionId}&box_number=BOX-001&box_type=medium&sealed=true&weight_lbs=15.5&fragile_contents=true&color_code=blue`, (err, res) => {
              if (err) {
                assert('Create Container', false, `Error: ${err.message}`);
                return;
              }

              assert('Create Container - Status', res.status === 200, `Status code is ${res.status}`);
              assert('Create Container - Response', Array.isArray(res.body) && res.body.length > 0, 'Returns container ID');

              if (res.body && res.body[0] && res.body[0].id) {
                console.log(`  Created container with ID: ${res.body[0].id}`);
              }

              // Print summary
              printSummary();
            });
          });
        } else {
          printSummary();
        }
      });
    } else {
      printSummary();
    }
  });
}

function printSummary() {
  console.log('\n' + '─'.repeat(60));
  console.log('\n📊 Test Summary\n');
  console.log(`Total Tests: ${testResults.passed + testResults.failed}`);
  console.log(`✓ Passed: ${testResults.passed}`);
  console.log(`✗ Failed: ${testResults.failed}`);
  console.log(`Success Rate: ${((testResults.passed / (testResults.passed + testResults.failed)) * 100).toFixed(1)}%`);

  if (testResults.failed > 0) {
    console.log('\n❌ Failed Tests:');
    testResults.tests.filter(t => t.status === 'FAIL').forEach(t => {
      console.log(`  - ${t.name}: ${t.message}`);
    });
  }

  console.log('\n' + '─'.repeat(60));

  if (testResults.failed === 0) {
    console.log('\n✅ All tests passed!\n');
    process.exit(0);
  } else {
    console.log('\n❌ Some tests failed.\n');
    process.exit(1);
  }
}

// Run the tests
runTests();
