// db.js
import postgres from 'postgres'

// Connection details
const sql = postgres({
  host: 'aws-1-ap-south-1.pooler.supabase.com',
  port: 6543,
  database: 'postgres',
  username: 'postgres.ugqqqhdlzyymlrwqvwip',
  password: 'SbkvV5bYxYNP2Z0D',  // apna password yaha daal do
  ssl: true,
  application_name: 'my-app',
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
    mode: 'transaction' // aapka pool_mode
  }
})

export default sql

// Test query
(async () => {
  try {
    const result = await sql`SELECT NOW()`
    console.log('Database connected, current time:', result)
  } catch (err) {
    console.error('Connection error:', err)
  }
})()
