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
    await sql`SELECT 1`;
    console.log('Database connection successful');
  } catch (err) {
    console.error('Database connection failed:', err);
    process.exit(1);
  } finally {
    await sql.end();
  }
})();
