const dotenv = require('dotenv');
const postgres = require('postgres');

dotenv.config({ path: '.env.local' });

(async () => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL not set');
    process.exit(1);
  }

  const sql = postgres(connectionString, { ssl: 'require' });
  try {
    const rows = await sql`SELECT * FROM users LIMIT 1`;
    console.log('Users query result:', rows);
  } catch (err) {
    console.error('Users query failed:', err.message || err);
    process.exit(1);
  } finally {
    await sql.end();
  }
})();
