require('dotenv').config();
const { Pool } = require('pg');

// Check if DATABASE_URL exists
if (!process.env.DATABASE_URL) {
  console.error("❌ DATABASE_URL missing in .env file!");
  process.exit(1);
}

// Create PostgreSQL pool
const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'trading_app',
    password: '195990',
    port: 5432,
});

module.exports = pool;
