const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  host: 'db.ugqqqhdlzyymlrwqvwip.supabase.co', // IPv4 preference
  database: 'postgres',
  password: 'SbkvV5bYxYNP2Z0D',                 // your DB password
  port: 5432,
  ssl: { rejectUnauthorized: false }
});

pool
  .query('SELECT 1')
  .then(() => console.log('✅ DB CONNECTED SUCCESSFULLY'))
  .catch((err) => console.error('❌ DB ERROR:', err.message));

module.exports = pool;
