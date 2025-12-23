require('dotenv').config();
const { Pool } = require('pg');

// Check if DATABASE_URL exists
if (!process.env.DATABASE_URL) {
  console.error("❌ DATABASE_URL missing in .env file!");
  process.exit(1);
}

// Create PostgreSQL pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: true // Production me true, dev/testing me false
  }
});

// Optional: test connection
pool.connect()
  .then(client => {
    console.log("✅ Connected to PostgreSQL successfully!");
    client.release();
  })
  .catch(err => {
    console.error("❌ Connection error:", err.stack);
  });

module.exports = pool;
