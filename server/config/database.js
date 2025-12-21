const { Pool } = require('pg');

const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'trading_app',
    password: '195990',
    port: 5432,
});

module.exports = pool;