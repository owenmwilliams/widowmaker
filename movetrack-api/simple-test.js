/**
 * Simple API Test Script (No Auth Required)
 * Tests only endpoints without authentication
 */

const http = require('http');

const API_BASE = 'http://localhost:3050';
const TEST_USER = 'test_user_simple';

let passed = 0;
let failed = 0;

function test(name, condition) {
  if (condition) {
    console.log(`✓ ${name}`);
    passed++;
  } else {
    console.log(`✗ ${name}`);
    failed++;
  }
}

function makeRequest(method, path) {
  return new Promise((resolve, reject) => {
    const url = new URL(API_BASE + path);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function runTests() {
  console.log('\n🧪 Nexus Moves API Tests (No Auth)\n');
  console.log('─'.repeat(60));

  try {
    // Test 1: Create Collection
    console.log('\n📦 Test 1: Create Collection with granted_by field');
    const createCollection = await makeRequest('POST', `/collections/post?user=${TEST_USER}&name=Test%20Collection&description=Testing`);
    test('Collections POST returns 200', createCollection.status === 200);
    test('Collections POST returns ID', Array.isArray(createCollection.body) && createCollection.body[0]?.id);

    const collectionId = createCollection.body[0]?.id;
    console.log(`  ✓ Created collection ID: ${collectionId}`);

    // Test 2: Create Container with Nexus Moves fields
    console.log('\n📦 Test 2: Create Container with Nexus Moves Fields');
    const createContainer = await makeRequest('POST', `/containers/post?user=${TEST_USER}&name=Test%20Box&collection=${collectionId}&box_number=BOX-TEST-001&box_type=medium&sealed=false&weight_lbs=10.5&fragile_contents=true&color_code=blue`);
    test('Containers POST returns 200', createContainer.status === 200);
    test('Containers POST returns ID', Array.isArray(createContainer.body) && createContainer.body[0]?.id);

    const containerId = createContainer.body[0]?.id;
    if (containerId) {
      console.log(`  ✓ Created container ID: ${containerId}`);

      // Test 3: Update Container (seal it)
      console.log('\n📦 Test 3: Seal Container (sets sealed_at timestamp)');
      const updateContainer = await makeRequest('PUT', `/containers/update?container_id=${containerId}&sealed=true&weight_lbs=15.0`);
      test('Containers PUT returns 200', updateContainer.status === 200);
      test('Containers PUT returns OK', updateContainer.body === 'OK');
      console.log('  ✓ Container sealed successfully');
    }

    // Test 4: Update Collection
    console.log('\n📦 Test 4: Update Collection');
    const updateCollection = await makeRequest('PUT', `/collections/update?collection_id=${collectionId}&user=${TEST_USER}&name=Updated%20Name&description=Updated`);
    test('Collections PUT returns 200', updateCollection.status === 200);
    test('Collections PUT returns OK', updateCollection.body === 'OK');

    // Test 5: Test different box types
    console.log('\n📦 Test 5: Test Different Box Types');
    const boxTypes = ['small', 'medium', 'large', 'wardrobe', 'custom'];
    for (const boxType of boxTypes) {
      const result = await makeRequest('POST', `/containers/post?user=${TEST_USER}&name=${boxType}%20box&collection=${collectionId}&box_type=${boxType}`);
      test(`Create ${boxType} box`, result.status === 200);
    }

    // Test 6: Test container with all Nexus Moves fields
    console.log('\n📦 Test 6: Container with All Nexus Moves Fields');
    const fullContainer = await makeRequest('POST', `/containers/post?user=${TEST_USER}&name=Full%20Test%20Box&collection=${collectionId}&box_number=FULL-001&box_type=large&sealed=true&weight_lbs=25.5&fragile_contents=true&qr_code=QR123&color_code=yellow`);
    test('Container with all fields returns 200', fullContainer.status === 200);
    test('Container with all fields returns ID', Array.isArray(fullContainer.body) && fullContainer.body[0]?.id);

    // Print summary
    console.log('\n' + '─'.repeat(60));
    console.log('\n📊 Test Summary\n');
    console.log(`Total Tests: ${passed + failed}`);
    console.log(`✓ Passed: ${passed}`);
    console.log(`✗ Failed: ${failed}`);
    console.log(`Success Rate: ${((passed / (passed + failed)) * 100).toFixed(1)}%`);
    console.log('\n' + '─'.repeat(60));

    if (failed === 0) {
      console.log('\n✅ All tests passed!\n');
      console.log('📝 Note: Items endpoint requires authentication (JWT)');
      console.log('   To test items, you need to either:');
      console.log('   1. Remove jwtCheck from line 67 in app.js, OR');
      console.log('   2. Provide a valid JWT token\n');
    } else {
      console.log('\n❌ Some tests failed.\n');
    }

  } catch (error) {
    console.error('\n❌ Test error:', error.message);
    process.exit(1);
  }
}

runTests();
