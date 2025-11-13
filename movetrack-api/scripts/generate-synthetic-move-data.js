/**
 * Synthetic Data Generator for 1BR/1BA Apartment Move
 * Seattle, WA to Denver, CO
 *
 * Run with: node scripts/generate-synthetic-move-data.js <user_name>
 */

const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.MT_DATALAYER_HOSTNAME || 'localhost',
  port: process.env.MT_DATALAYER_PORT || 5432,
  database: process.env.MT_DATALAYER_DATABASE || 'movetrack_db',
  user: process.env.MT_DATALAYER_USERNAME || 'movetrack_user',
  password: process.env.MT_DATALAYER_PASSWORD || 'changeme123',
});

const userName = process.argv[2];

if (!userName) {
  console.error('Usage: node generate-synthetic-move-data.js <user_name>');
  process.exit(1);
}

// Synthetic data for a typical 1BR/1BA apartment move
const syntheticData = {
  locations: [
    {
      name: 'Seattle Apartment',
      address: '1234 Pike St',
      city: 'Seattle',
      state: 'WA',
      zip: '98101'
    },
    {
      name: 'Denver Apartment',
      address: '5678 Colfax Ave',
      city: 'Denver',
      state: 'CO',
      zip: '80202'
    }
  ],
  collections: [
    { name: 'Living Room' },
    { name: 'Bedroom' },
    { name: 'Kitchen' },
    { name: 'Bathroom' },
    { name: 'Office/Work Area' },
    { name: 'Closet & Storage' }
  ],
  items: [
    // Living Room
    { label: 'Sofa', collection: 'Living Room', length_in: 84, width_in: 36, height_in: 36, weight_lbs: 150, estimated_value: 800, fragile: false },
    { label: 'Coffee Table', collection: 'Living Room', length_in: 48, width_in: 24, height_in: 18, weight_lbs: 40, estimated_value: 200, fragile: false },
    { label: 'TV Stand', collection: 'Living Room', length_in: 60, width_in: 18, height_in: 24, weight_lbs: 60, estimated_value: 300, fragile: false },
    { label: '55" TV', collection: 'Living Room', length_in: 49, width_in: 3, height_in: 28, weight_lbs: 35, estimated_value: 600, fragile: true },
    { label: 'Floor Lamp', collection: 'Living Room', length_in: 12, width_in: 12, height_in: 65, weight_lbs: 15, estimated_value: 80, fragile: true },
    { label: 'Bookshelf', collection: 'Living Room', length_in: 36, width_in: 12, height_in: 72, weight_lbs: 80, estimated_value: 250, fragile: false },
    { label: 'Books', collection: 'Living Room', quantity: 45, length_in: 9, width_in: 6, height_in: 1, weight_lbs: 2, estimated_value: 15, fragile: false },
    { label: 'Throw Pillows', collection: 'Living Room', quantity: 4, length_in: 18, width_in: 18, height_in: 6, weight_lbs: 2, estimated_value: 30, fragile: false },
    { label: 'Area Rug (5x7)', collection: 'Living Room', length_in: 84, width_in: 60, height_in: 1, weight_lbs: 25, estimated_value: 300, fragile: false },
    { label: 'Wall Art (framed)', collection: 'Living Room', quantity: 3, length_in: 24, width_in: 2, height_in: 36, weight_lbs: 8, estimated_value: 150, fragile: true },

    // Bedroom
    { label: 'Queen Bed Frame', collection: 'Bedroom', length_in: 84, width_in: 64, height_in: 14, weight_lbs: 120, estimated_value: 400, fragile: false },
    { label: 'Queen Mattress', collection: 'Bedroom', length_in: 80, width_in: 60, height_in: 12, weight_lbs: 90, estimated_value: 800, fragile: false },
    { label: 'Box Spring', collection: 'Bedroom', length_in: 80, width_in: 60, height_in: 9, weight_lbs: 70, estimated_value: 200, fragile: false },
    { label: 'Dresser (6-drawer)', collection: 'Bedroom', length_in: 60, width_in: 18, height_in: 36, weight_lbs: 150, estimated_value: 500, fragile: false },
    { label: 'Nightstand', collection: 'Bedroom', quantity: 2, length_in: 20, width_in: 16, height_in: 24, weight_lbs: 30, estimated_value: 150, fragile: false },
    { label: 'Table Lamp', collection: 'Bedroom', quantity: 2, length_in: 10, width_in: 10, height_in: 18, weight_lbs: 5, estimated_value: 60, fragile: true },
    { label: 'Full-length Mirror', collection: 'Bedroom', length_in: 24, width_in: 3, height_in: 66, weight_lbs: 25, estimated_value: 120, fragile: true },
    { label: 'Bedding Set', collection: 'Bedroom', length_in: 24, width_in: 18, height_in: 12, weight_lbs: 8, estimated_value: 150, fragile: false },
    { label: 'Pillows', collection: 'Bedroom', quantity: 4, length_in: 20, width_in: 26, height_in: 6, weight_lbs: 2, estimated_value: 40, fragile: false },
    { label: 'Clothes (hanging)', collection: 'Bedroom', quantity: 30, length_in: 24, width_in: 2, height_in: 36, weight_lbs: 2, estimated_value: 80, fragile: false },
    { label: 'Clothes (folded)', collection: 'Bedroom', quantity: 40, length_in: 12, width_in: 12, height_in: 4, weight_lbs: 1, estimated_value: 50, fragile: false },
    { label: 'Shoes', collection: 'Bedroom', quantity: 12, length_in: 12, width_in: 8, height_in: 6, weight_lbs: 2, estimated_value: 100, fragile: false },

    // Kitchen
    { label: 'Dining Table', collection: 'Kitchen', length_in: 60, width_in: 36, height_in: 30, weight_lbs: 80, estimated_value: 400, fragile: false },
    { label: 'Dining Chairs', collection: 'Kitchen', quantity: 4, length_in: 18, width_in: 20, height_in: 36, weight_lbs: 15, estimated_value: 120, fragile: false },
    { label: 'Plates & Bowls', collection: 'Kitchen', quantity: 16, length_in: 11, width_in: 11, height_in: 2, weight_lbs: 2, estimated_value: 10, fragile: true },
    { label: 'Glasses', collection: 'Kitchen', quantity: 12, length_in: 3, width_in: 3, height_in: 6, weight_lbs: 0.5, estimated_value: 5, fragile: true },
    { label: 'Mugs', collection: 'Kitchen', quantity: 8, length_in: 4, width_in: 4, height_in: 5, weight_lbs: 1, estimated_value: 8, fragile: true },
    { label: 'Cookware Set', collection: 'Kitchen', length_in: 16, width_in: 16, height_in: 12, weight_lbs: 20, estimated_value: 200, fragile: false },
    { label: 'Baking Sheets & Pans', collection: 'Kitchen', quantity: 6, length_in: 18, width_in: 13, height_in: 2, weight_lbs: 3, estimated_value: 30, fragile: false },
    { label: 'Utensils & Silverware', collection: 'Kitchen', length_in: 12, width_in: 8, height_in: 4, weight_lbs: 5, estimated_value: 80, fragile: false },
    { label: 'KitchenAid Mixer', collection: 'Kitchen', length_in: 14, width_in: 9, height_in: 14, weight_lbs: 22, estimated_value: 350, fragile: true },
    { label: 'Blender', collection: 'Kitchen', length_in: 8, width_in: 8, height_in: 16, weight_lbs: 8, estimated_value: 100, fragile: true },
    { label: 'Coffee Maker', collection: 'Kitchen', length_in: 10, width_in: 12, height_in: 14, weight_lbs: 6, estimated_value: 120, fragile: true },
    { label: 'Toaster', collection: 'Kitchen', length_in: 12, width_in: 8, height_in: 8, weight_lbs: 5, estimated_value: 50, fragile: false },
    { label: 'Microwave', collection: 'Kitchen', length_in: 20, width_in: 16, height_in: 12, weight_lbs: 35, estimated_value: 150, fragile: true },
    { label: 'Pantry Items (dry goods)', collection: 'Kitchen', quantity: 20, length_in: 8, width_in: 6, height_in: 10, weight_lbs: 2, estimated_value: 8, fragile: false },
    { label: 'Spice Rack', collection: 'Kitchen', length_in: 18, width_in: 4, height_in: 12, weight_lbs: 10, estimated_value: 60, fragile: true },

    // Bathroom
    { label: 'Bathroom Towels', collection: 'Bathroom', quantity: 8, length_in: 27, width_in: 52, height_in: 2, weight_lbs: 2, estimated_value: 30, fragile: false },
    { label: 'Toiletries & Cosmetics', collection: 'Bathroom', quantity: 25, length_in: 6, width_in: 4, height_in: 8, weight_lbs: 1, estimated_value: 20, fragile: true },
    { label: 'Bathroom Scale', collection: 'Bathroom', length_in: 12, width_in: 12, height_in: 2, weight_lbs: 5, estimated_value: 40, fragile: true },
    { label: 'Shower Caddy', collection: 'Bathroom', length_in: 24, width_in: 12, height_in: 36, weight_lbs: 8, estimated_value: 45, fragile: false },
    { label: 'Bath Mat', collection: 'Bathroom', quantity: 2, length_in: 24, width_in: 17, height_in: 1, weight_lbs: 2, estimated_value: 25, fragile: false },
    { label: 'Waste Basket', collection: 'Bathroom', length_in: 10, width_in: 10, height_in: 12, weight_lbs: 2, estimated_value: 20, fragile: false },

    // Office/Work Area
    { label: 'Desk', collection: 'Office/Work Area', length_in: 60, width_in: 30, height_in: 30, weight_lbs: 80, estimated_value: 350, fragile: false },
    { label: 'Office Chair', collection: 'Office/Work Area', length_in: 26, width_in: 26, height_in: 42, weight_lbs: 40, estimated_value: 250, fragile: false },
    { label: 'Laptop', collection: 'Office/Work Area', length_in: 14, width_in: 10, height_in: 1, weight_lbs: 4, estimated_value: 1200, fragile: true },
    { label: 'Monitor', collection: 'Office/Work Area', length_in: 24, width_in: 8, height_in: 16, weight_lbs: 12, estimated_value: 400, fragile: true },
    { label: 'Keyboard & Mouse', collection: 'Office/Work Area', length_in: 18, width_in: 8, height_in: 2, weight_lbs: 2, estimated_value: 150, fragile: true },
    { label: 'Desk Lamp', collection: 'Office/Work Area', length_in: 8, width_in: 8, height_in: 18, weight_lbs: 4, estimated_value: 60, fragile: true },
    { label: 'File Cabinet', collection: 'Office/Work Area', length_in: 15, width_in: 18, height_in: 28, weight_lbs: 50, estimated_value: 180, fragile: false },
    { label: 'Office Supplies', collection: 'Office/Work Area', length_in: 12, width_in: 12, height_in: 12, weight_lbs: 10, estimated_value: 75, fragile: false },
    { label: 'Printer', collection: 'Office/Work Area', length_in: 18, width_in: 16, height_in: 8, weight_lbs: 15, estimated_value: 200, fragile: true },

    // Closet & Storage
    { label: 'Vacuum Cleaner', collection: 'Closet & Storage', length_in: 14, width_in: 12, height_in: 44, weight_lbs: 18, estimated_value: 200, fragile: false },
    { label: 'Iron & Ironing Board', collection: 'Closet & Storage', length_in: 54, width_in: 15, height_in: 6, weight_lbs: 15, estimated_value: 80, fragile: false },
    { label: 'Cleaning Supplies', collection: 'Closet & Storage', quantity: 10, length_in: 8, width_in: 6, height_in: 12, weight_lbs: 3, estimated_value: 10, fragile: false },
    { label: 'Tool Box', collection: 'Closet & Storage', length_in: 20, width_in: 10, height_in: 10, weight_lbs: 25, estimated_value: 150, fragile: false },
    { label: 'Luggage', collection: 'Closet & Storage', quantity: 3, length_in: 28, width_in: 18, height_in: 10, weight_lbs: 12, estimated_value: 150, fragile: false },
    { label: 'Winter Coats', collection: 'Closet & Storage', quantity: 4, length_in: 24, width_in: 4, height_in: 36, weight_lbs: 5, estimated_value: 200, fragile: false },
    { label: 'Storage Bins', collection: 'Closet & Storage', quantity: 6, length_in: 24, width_in: 16, height_in: 12, weight_lbs: 15, estimated_value: 30, fragile: false },
    { label: 'Sports Equipment (bikes, yoga mat, weights)', collection: 'Closet & Storage', quantity: 5, length_in: 36, width_in: 24, height_in: 12, weight_lbs: 30, estimated_value: 300, fragile: false },
    { label: 'Christmas Decorations', collection: 'Closet & Storage', quantity: 2, length_in: 18, width_in: 18, height_in: 18, weight_lbs: 10, estimated_value: 100, fragile: true },
  ]
};

async function generateSyntheticData() {
  const client = await pool.connect();

  try {
    console.log('Starting synthetic data generation...');
    console.log(`Username: ${userName}`);

    // Begin transaction
    await client.query('BEGIN');

    // Insert locations
    console.log('\nCreating locations...');
    const locationMap = {};
    for (const location of syntheticData.locations) {
      const result = await client.query(
        'INSERT INTO locations (owner, name, address, city, state, zip) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
        [userName, location.name, location.address, location.city, location.state, location.zip]
      );
      locationMap[location.name] = result.rows[0].id;
      console.log(`  ✓ ${location.name}`);
    }

    // Insert collections
    console.log('\nCreating collections...');
    const collectionMap = {};
    for (const collection of syntheticData.collections) {
      const result = await client.query(
        'INSERT INTO collections (owner, name) VALUES ($1, $2) RETURNING id',
        [userName, collection.name]
      );
      collectionMap[collection.name] = result.rows[0].id;
      console.log(`  ✓ ${collection.name}`);
    }

    // Create a "Packing Supplies" collection
    const packingSuppliesResult = await client.query(
      'INSERT INTO collections (owner, name) VALUES ($1, $2) RETURNING id',
      [userName, 'Packing Supplies']
    );
    collectionMap['Packing Supplies'] = packingSuppliesResult.rows[0].id;
    console.log('  ✓ Packing Supplies');

    // Insert items
    console.log('\nCreating items...');
    let itemCount = 0;
    for (const item of syntheticData.items) {
      const collectionId = collectionMap[item.collection];
      const quantity = item.quantity || 1;
      const dimensions = `${item.length_in}x${item.width_in}x${item.height_in}`;

      await client.query(
        `INSERT INTO items (
          owner, name, collection_id, location_id,
          dimensions, weight_lbs,
          estimated_value, fragile, quantity
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          userName,
          item.label,
          collectionId,
          locationMap['Seattle Apartment'],
          dimensions,
          item.weight_lbs,
          item.estimated_value,
          item.fragile,
          quantity
        ]
      );
      itemCount++;
      if (itemCount % 10 === 0) {
        console.log(`  Created ${itemCount} items...`);
      }
    }
    console.log(`  ✓ Total items created: ${itemCount}`);

    // Commit transaction
    await client.query('COMMIT');

    // Summary
    console.log('\n' + '='.repeat(50));
    console.log('Synthetic Data Generation Complete!');
    console.log('='.repeat(50));
    console.log(`Locations: ${syntheticData.locations.length}`);
    console.log(`Collections: ${syntheticData.collections.length + 1} (including Packing Supplies)`);
    console.log(`Items: ${itemCount}`);
    console.log('\nMove Details:');
    console.log(`  Origin: Seattle Apartment`);
    console.log(`  Destination: Denver Apartment`);
    console.log(`  Type: 1 Bedroom / 1 Bathroom Apartment`);

    // Calculate totals
    const totalWeight = syntheticData.items.reduce((sum, item) => {
      return sum + (item.weight_lbs * (item.quantity || 1));
    }, 0);

    const totalValue = syntheticData.items.reduce((sum, item) => {
      return sum + (item.estimated_value * (item.quantity || 1));
    }, 0);

    const totalVolume = syntheticData.items.reduce((sum, item) => {
      const volume = (item.length_in * item.width_in * item.height_in) / 1728; // cu ft
      return sum + (volume * (item.quantity || 1));
    }, 0);

    console.log(`\nEstimated Totals:`);
    console.log(`  Total Weight: ${totalWeight.toFixed(0)} lbs`);
    console.log(`  Total Volume: ${totalVolume.toFixed(1)} cubic feet`);
    console.log(`  Total Value: $${totalValue.toLocaleString()}`);
    console.log(`  Recommended Truck: 15 ft (700 cu ft capacity)`);
    console.log('='.repeat(50));

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error generating synthetic data:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

generateSyntheticData().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
