const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false   // 👈 YAHI FIX HAI
});

pool.query('SELECT 1')
  .then(() => console.log('✅ DB CONNECTED SUCCESSFULLY'))
  .catch(err => console.error('❌ DB ERROR:', err.message));

module.exports = pool;
