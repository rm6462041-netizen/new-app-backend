require('dotenv').config();
const { Pool } = require('pg');

// Safety check
if (!process.env.DATABASE_URL) {
  console.error("❌ DATABASE_URL missing in environment variables");
  process.exit(1);
}

// Supabase connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

module.exports = pool;
