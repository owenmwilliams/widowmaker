/**
 * Get or create a test user and generate synthetic data
 * This will find an existing user or create a test user, then generate data for them
 */

const { Pool } = require('pg');
const { execSync } = require('child_process');

const pool = new Pool({
  host: process.env.MT_DATALAYER_HOSTNAME || 'localhost',
  port: process.env.MT_DATALAYER_PORT || 5432,
  database: process.env.MT_DATALAYER_DATABASE || 'movetrack_db',
  user: process.env.MT_DATALAYER_USERNAME || 'movetrack_user',
  password: process.env.MT_DATALAYER_PASSWORD || 'changeme123',
});

async function getOrCreateTestUser() {
  const client = await pool.connect();

  try {
    console.log('Looking for existing users...\n');

    // Check for existing users
    const usersResult = await client.query('SELECT user_id, email, user_name, first_name, last_name FROM users ORDER BY created_at DESC LIMIT 10');

    if (usersResult.rows.length > 0) {
      console.log('Found existing users:');
      usersResult.rows.forEach((user, index) => {
        const displayName = user.first_name && user.last_name
          ? `${user.first_name} ${user.last_name}`
          : user.user_name || user.email;
        console.log(`  ${index + 1}. ${displayName} (ID: ${user.user_id})`);
      });

      // Use the first user
      const user = usersResult.rows[0];
      const displayName = user.first_name && user.last_name
        ? `${user.first_name} ${user.last_name}`
        : user.user_name || user.email;
      console.log(`\nUsing user: ${displayName} (username: ${user.user_name})`);
      return user.user_name; // Return username, not user_id
    } else {
      console.log('No users found. Creating test user...');

      // Create a test user
      const newUserResult = await client.query(
        `INSERT INTO users (user_name, email, first_name, last_name) VALUES ($1, $2, $3, $4) RETURNING user_id, email, user_name, first_name, last_name`,
        ['testuser', 'test@movetrack.com', 'Test', 'User']
      );

      const newUser = newUserResult.rows[0];
      console.log(`\nCreated test user: ${newUser.first_name} ${newUser.last_name} (username: ${newUser.user_name})`);
      return newUser.user_name; // Return username, not user_id
    }
  } finally {
    client.release();
    await pool.end();
  }
}

async function main() {
  try {
    const userId = await getOrCreateTestUser();

    console.log('\n' + '='.repeat(60));
    console.log('Generating synthetic data for user...');
    console.log('='.repeat(60) + '\n');

    // Run the synthetic data generation script
    execSync(
      `node ${__dirname}/generate-synthetic-move-data.js ${userId}`,
      { stdio: 'inherit' }
    );

    console.log('\n' + '='.repeat(60));
    console.log('SUCCESS! You can now log in with this user.');
    console.log('='.repeat(60));
    console.log(`\nUsername: ${userId}`);
    console.log('\nTo access the data in your app, make sure you\'re logged in as this user.');

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
