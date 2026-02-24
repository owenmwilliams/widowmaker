/**
 * MoveTrack Synthetic Data Generator
 *
 * Generates realistic test data for a complete moving scenario:
 * - Multiple locations (current home, new home, storage unit)
 * - Multiple collections (rooms: Kitchen, Living Room, Bedroom, etc.)
 * - Multiple containers per collection (boxes with realistic attributes)
 * - Multiple items per container (with realistic MoveTrack fields)
 *
 * Run with: node generate-test-data.js
 */

const http = require('http');

const API_BASE = 'http://localhost:3050';
const TEST_USER = 'demo_user'; // Change this to your user ID

// Tracking for created entities
const created = {
  locations: [],
  collections: [],
  containers: [],
  items: []
};

// Synthetic data definitions
const LOCATIONS = [
  {
    name: 'San Francisco Apartment',
    type: 'residence',
    address: '1234 Market St',
    address_2: 'Apt 4B',
    city: 'San Francisco',
    state: 'CA',
    zip: '94102',
    notes: 'Current residence - move out by Nov 30'
  },
  {
    name: 'Oakland House',
    type: 'residence',
    address: '5678 Broadway',
    city: 'Oakland',
    state: 'CA',
    zip: '94612',
    notes: 'New home - move in Dec 1'
  },
  {
    name: 'Public Storage - Mission District',
    type: 'storage_unit',
    address: '789 Valencia St',
    city: 'San Francisco',
    state: 'CA',
    zip: '94110',
    unit_number: 'C-247',
    access_code: '1234#',
    notes: 'Temporary storage during move'
  }
];

const COLLECTIONS = [
  { name: 'Kitchen', description: 'All kitchen items, cookware, and appliances', color_code: 'yellow' },
  { name: 'Living Room', description: 'Furniture, TV, decorations', color_code: 'blue' },
  { name: 'Master Bedroom', description: 'Bedroom furniture and personal items', color_code: 'purple' },
  { name: 'Office', description: 'Desk, computer equipment, books', color_code: 'green' },
  { name: 'Bathroom', description: 'Toiletries, towels, bathroom items', color_code: 'cyan' },
  { name: 'Garage/Storage', description: 'Tools, holiday decorations, miscellaneous', color_code: 'orange' }
];

const KITCHEN_ITEMS = [
  { name: 'Dinner Plates Set', description: '12-piece ceramic dinner plates', quantity: 12, value: 120, fragile: true, priority: 'high', weight: 15, dimensions: '10x10x12' },
  { name: 'Wine Glasses', description: 'Crystal wine glasses', quantity: 8, value: 200, fragile: true, priority: 'high', weight: 5, dimensions: '8x8x10' },
  { name: 'KitchenAid Mixer', description: 'Stand mixer with attachments', quantity: 1, value: 350, fragile: false, priority: 'high', weight: 22, dimensions: '14x9x14' },
  { name: 'Pots and Pans Set', description: 'Stainless steel cookware', quantity: 10, value: 300, fragile: false, priority: 'normal', weight: 25, dimensions: '18x12x10' },
  { name: 'Cutlery Set', description: 'Silverware for 12', quantity: 60, value: 150, fragile: false, priority: 'normal', weight: 8, dimensions: '14x10x3' },
  { name: 'Coffee Maker', description: 'Programmable drip coffee maker', quantity: 1, value: 80, fragile: true, priority: 'high', weight: 6, dimensions: '12x8x14' },
  { name: 'Blender', description: 'High-speed blender', quantity: 1, value: 200, fragile: true, priority: 'normal', weight: 8, dimensions: '8x8x16' },
  { name: 'Kitchen Utensils', description: 'Spatulas, spoons, whisks, etc.', quantity: 20, value: 50, fragile: false, priority: 'low', weight: 3, dimensions: '12x6x3' },
  { name: 'Tupperware Set', description: 'Plastic food storage containers', quantity: 15, value: 40, fragile: false, priority: 'low', weight: 5, dimensions: '12x12x8' },
  { name: 'Cast Iron Skillet', description: 'Lodge 12-inch skillet', quantity: 1, value: 45, fragile: false, priority: 'normal', weight: 8, dimensions: '12x12x3' }
];

const LIVING_ROOM_ITEMS = [
  { name: 'TV 55-inch', description: 'Samsung 4K Smart TV', quantity: 1, value: 800, fragile: true, priority: 'high', weight: 35, dimensions: '49x28x3', notes: 'Keep upright, original box if possible' },
  { name: 'TV Stand', description: 'Wooden media console', quantity: 1, value: 300, fragile: false, priority: 'normal', weight: 65, dimensions: '60x18x24' },
  { name: 'Throw Pillows', description: 'Decorative couch pillows', quantity: 6, value: 120, fragile: false, priority: 'low', weight: 5, dimensions: '18x18x18' },
  { name: 'Table Lamps', description: 'Pair of table lamps', quantity: 2, value: 150, fragile: true, priority: 'normal', weight: 8, dimensions: '12x12x24' },
  { name: 'Coffee Table Books', description: 'Art and photography books', quantity: 12, value: 200, fragile: false, priority: 'low', weight: 30, dimensions: '14x11x18' },
  { name: 'Picture Frames', description: 'Framed family photos and art', quantity: 15, value: 300, fragile: true, priority: 'normal', weight: 20, dimensions: '24x18x12', notes: 'Wrap each individually' },
  { name: 'Area Rug', description: '8x10 Persian-style rug', quantity: 1, value: 500, fragile: false, priority: 'normal', weight: 40, dimensions: '96x120x1' },
  { name: 'Sound System', description: 'Receiver and speakers', quantity: 1, value: 600, fragile: true, priority: 'high', weight: 25, dimensions: '20x16x12' }
];

const BEDROOM_ITEMS = [
  { name: 'Bedding Set', description: 'Comforter, sheets, pillowcases', quantity: 1, value: 200, fragile: false, priority: 'high', weight: 10, dimensions: '18x14x10' },
  { name: 'Pillows', description: 'Memory foam pillows', quantity: 4, value: 120, fragile: false, priority: 'normal', weight: 8, dimensions: '20x26x6' },
  { name: 'Clothing - Hanging', description: 'Suits, dresses, coats', quantity: 30, value: 2000, fragile: false, priority: 'high', weight: 20, dimensions: 'wardrobe' },
  { name: 'Clothing - Folded', description: 'T-shirts, sweaters, jeans', quantity: 50, value: 1500, fragile: false, priority: 'normal', weight: 25, dimensions: '24x18x12' },
  { name: 'Shoes', description: 'Various shoes and boots', quantity: 20, value: 1000, fragile: false, priority: 'normal', weight: 30, dimensions: '24x18x12' },
  { name: 'Jewelry Box', description: 'Wooden jewelry organizer', quantity: 1, value: 3000, fragile: true, priority: 'high', weight: 5, dimensions: '12x10x6', notes: 'Keep with valuable items' },
  { name: 'Alarm Clock', description: 'Digital alarm clock', quantity: 1, value: 30, fragile: false, priority: 'low', weight: 1, dimensions: '6x4x3' },
  { name: 'Books', description: 'Bedside reading books', quantity: 15, value: 150, fragile: false, priority: 'low', weight: 20, dimensions: '12x10x8' }
];

const OFFICE_ITEMS = [
  { name: 'Laptop - MacBook Pro', description: '16-inch MacBook Pro', quantity: 1, value: 2500, fragile: true, priority: 'high', weight: 5, dimensions: '14x10x1', notes: 'Keep with me during move' },
  { name: 'Monitor 27-inch', description: 'Dell 4K monitor', quantity: 2, value: 1000, fragile: true, priority: 'high', weight: 15, dimensions: '24x16x8' },
  { name: 'Office Chair', description: 'Herman Miller Aeron', quantity: 1, value: 1200, fragile: false, priority: 'high', weight: 50, dimensions: '26x26x42' },
  { name: 'File Boxes', description: 'Important documents', quantity: 3, value: 0, fragile: false, priority: 'high', weight: 30, dimensions: '16x12x10', notes: 'Contains tax records and contracts' },
  { name: 'Keyboard and Mouse', description: 'Mechanical keyboard, wireless mouse', quantity: 2, value: 200, fragile: false, priority: 'normal', weight: 3, dimensions: '18x8x4' },
  { name: 'Desk Lamp', description: 'Adjustable LED desk lamp', quantity: 1, value: 80, fragile: true, priority: 'low', weight: 4, dimensions: '12x6x20' },
  { name: 'Printer', description: 'HP all-in-one printer', quantity: 1, value: 150, fragile: true, priority: 'normal', weight: 18, dimensions: '18x16x10' },
  { name: 'Books - Professional', description: 'Technical and business books', quantity: 40, value: 400, fragile: false, priority: 'low', weight: 50, dimensions: '18x12x20' },
  { name: 'Office Supplies', description: 'Pens, paper, folders, etc.', quantity: 1, value: 50, fragile: false, priority: 'low', weight: 10, dimensions: '16x12x8' }
];

const BATHROOM_ITEMS = [
  { name: 'Towel Set', description: 'Bath towels, hand towels, washcloths', quantity: 12, value: 100, fragile: false, priority: 'normal', weight: 8, dimensions: '18x14x10' },
  { name: 'Toiletries', description: 'Shampoo, soap, toothpaste, etc.', quantity: 20, value: 80, fragile: false, priority: 'normal', weight: 10, dimensions: '14x12x8' },
  { name: 'Medicine Cabinet Items', description: 'OTC medications, first aid', quantity: 30, value: 100, fragile: false, priority: 'high', weight: 5, dimensions: '12x10x6' },
  { name: 'Bathroom Scale', description: 'Digital scale', quantity: 1, value: 40, fragile: true, priority: 'low', weight: 5, dimensions: '12x12x2' },
  { name: 'Hair Dryer & Straightener', description: 'Hair styling tools', quantity: 2, value: 120, fragile: true, priority: 'normal', weight: 3, dimensions: '12x8x6' },
  { name: 'Bathroom Decor', description: 'Soap dispenser, toothbrush holder', quantity: 5, value: 50, fragile: true, priority: 'low', weight: 3, dimensions: '10x8x6' }
];

const GARAGE_ITEMS = [
  { name: 'Tool Box', description: 'Craftsman tool chest with tools', quantity: 1, value: 500, fragile: false, priority: 'normal', weight: 60, dimensions: '24x16x12' },
  { name: 'Power Drill Set', description: 'Cordless drill with bits', quantity: 1, value: 150, fragile: false, priority: 'normal', weight: 8, dimensions: '14x10x8' },
  { name: 'Ladder', description: '6-foot step ladder', quantity: 1, value: 80, fragile: false, priority: 'low', weight: 25, dimensions: '72x20x6' },
  { name: 'Christmas Decorations', description: 'Lights, ornaments, artificial tree', quantity: 5, value: 200, fragile: true, priority: 'low', weight: 30, dimensions: '24x18x18' },
  { name: 'Halloween Decorations', description: 'Costumes and decorations', quantity: 2, value: 100, fragile: false, priority: 'low', weight: 10, dimensions: '18x18x12' },
  { name: 'Camping Gear', description: 'Tent, sleeping bags, camp stove', quantity: 1, value: 400, fragile: false, priority: 'normal', weight: 35, dimensions: '36x18x18' },
  { name: 'Sports Equipment', description: 'Bikes, tennis rackets, balls', quantity: 5, value: 600, fragile: false, priority: 'low', weight: 50, dimensions: '48x24x24' },
  { name: 'Paint Supplies', description: 'Paint cans, brushes, drop cloths', quantity: 1, value: 80, fragile: false, priority: 'low', weight: 40, dimensions: '24x18x12' },
  { name: 'Garden Tools', description: 'Shovels, rakes, hose', quantity: 8, value: 150, fragile: false, priority: 'low', weight: 30, dimensions: '48x12x6' }
];

// Collection to items mapping
const COLLECTION_ITEMS = {
  'Kitchen': KITCHEN_ITEMS,
  'Living Room': LIVING_ROOM_ITEMS,
  'Master Bedroom': BEDROOM_ITEMS,
  'Office': OFFICE_ITEMS,
  'Bathroom': BATHROOM_ITEMS,
  'Garage/Storage': GARAGE_ITEMS
};

// Helper function to make HTTP requests
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

// Helper to add delay
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Generate box number
function generateBoxNumber(collectionName, index) {
  const prefix = collectionName.substring(0, 3).toUpperCase();
  return `${prefix}-${String(index + 1).padStart(3, '0')}`;
}

// Create locations
async function createLocations() {
  console.log('\n📍 Creating Locations...');
  for (const loc of LOCATIONS) {
    const path = `/locations/post?user=${TEST_USER}&name=${encodeURIComponent(loc.name)}&description=${encodeURIComponent(loc.notes || '')}&address=${encodeURIComponent(loc.address)}&address_2=${encodeURIComponent(loc.address_2 || '')}&city=${encodeURIComponent(loc.city)}&state=${encodeURIComponent(loc.state)}&zip=${encodeURIComponent(loc.zip)}`;
    const result = await makeRequest('POST', path);

    if (result.status === 200 && result.body[0]?.id) {
      created.locations.push({ ...loc, id: result.body[0].id });
      console.log(`  ✓ Created: ${loc.name} (ID: ${result.body[0].id})`);
    } else {
      console.log(`  ✗ Failed: ${loc.name}`);
    }
    await delay(100);
  }
}

// Create collections
async function createCollections() {
  console.log('\n📦 Creating Collections (Rooms)...');
  for (const coll of COLLECTIONS) {
    const path = `/collections/post?user=${TEST_USER}&name=${encodeURIComponent(coll.name)}&description=${encodeURIComponent(coll.description)}`;
    const result = await makeRequest('POST', path);

    if (result.status === 200 && result.body[0]?.id) {
      created.collections.push({ ...coll, id: result.body[0].id });
      console.log(`  ✓ Created: ${coll.name} (ID: ${result.body[0].id})`);
    } else {
      console.log(`  ✗ Failed: ${coll.name}`);
    }
    await delay(100);
  }
}

// Create containers for a collection
async function createContainersForCollection(collection, itemsList) {
  const numContainers = Math.ceil(itemsList.length / 4); // ~4 items per box
  const homeLocation = created.locations.find(l => l.name.includes('Apartment'));

  console.log(`\n📦 Creating ${numContainers} containers for ${collection.name}...`);

  for (let i = 0; i < numContainers; i++) {
    const boxTypes = ['small', 'medium', 'large'];
    const boxType = boxTypes[Math.floor(Math.random() * boxTypes.length)];
    const boxNumber = generateBoxNumber(collection.name, i);
    const hasFragile = itemsList.slice(i * 4, (i + 1) * 4).some(item => item.fragile);

    const path = `/containers/post?user=${TEST_USER}&name=${encodeURIComponent(collection.name + ' Box ' + (i + 1))}&collection=${collection.id}&location_id=${homeLocation?.id || ''}&box_number=${boxNumber}&box_type=${boxType}&sealed=false&fragile_contents=${hasFragile}&color_code=${collection.color_code}`;
    const result = await makeRequest('POST', path);

    if (result.status === 200 && result.body[0]?.id) {
      created.containers.push({
        id: result.body[0].id,
        collection_id: collection.id,
        collection_name: collection.name,
        index: i
      });
      console.log(`  ✓ Created: ${boxNumber} - ${collection.name} Box ${i + 1} (ID: ${result.body[0].id})`);
    } else {
      console.log(`  ✗ Failed: ${collection.name} Box ${i + 1}`);
    }
    await delay(100);
  }
}

// Note: Items endpoint requires authentication, so we'll skip item creation
// but provide instructions for manual testing

async function generateData() {
  console.log('🏠 MoveTrack Synthetic Data Generator');
  console.log('═'.repeat(60));
  console.log(`User: ${TEST_USER}`);
  console.log(`API: ${API_BASE}`);
  console.log('═'.repeat(60));

  try {
    // Step 1: Create locations
    await createLocations();

    // Step 2: Create collections
    await createCollections();

    // Step 3: Create containers for each collection
    for (const collection of created.collections) {
      const itemsList = COLLECTION_ITEMS[collection.name] || [];
      if (itemsList.length > 0) {
        await createContainersForCollection(collection, itemsList);
      }
    }

    // Summary
    console.log('\n' + '═'.repeat(60));
    console.log('\n📊 Data Generation Summary\n');
    console.log(`✓ Locations created: ${created.locations.length}`);
    console.log(`✓ Collections created: ${created.collections.length}`);
    console.log(`✓ Containers created: ${created.containers.length}`);
    console.log('\n' + '═'.repeat(60));

    console.log('\n⚠️  Items Not Created (Authentication Required)');
    console.log('\nThe /items endpoint requires JWT authentication.');
    console.log('To add items, you can:');
    console.log('  1. Use the web UI at http://localhost:4050');
    console.log('  2. Remove jwtCheck from app.js line 67');
    console.log('\n📋 Items ready to add:');

    let totalItems = 0;
    for (const [collName, items] of Object.entries(COLLECTION_ITEMS)) {
      console.log(`  • ${collName}: ${items.length} items`);
      totalItems += items.length;
    }
    console.log(`\n  Total: ${totalItems} items defined\n`);

    console.log('✅ Data generation complete!\n');
    console.log('🌐 Open http://localhost:4050 to view your inventory\n');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

// Run the generator
generateData();
