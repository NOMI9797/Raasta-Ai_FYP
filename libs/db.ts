/* global globalThis */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import * as schema from './schema';

// Create the connection
const connectionString = process.env.DATABASE_URL!;

// Next.js dev compiles each route (and every hot reload) into its own module
// instance, so a module-level client would open a new pool each time and
// exhaust Postgres's connection limit. Reuse one client per process.
const globalForDb = globalThis as unknown as { pgClient?: ReturnType<typeof postgres> };

const client =
  globalForDb.pgClient ??
  postgres(connectionString, {
    // Managed Postgres needs SSL; set DATABASE_SSL=false for a local database
    ssl: process.env.DATABASE_SSL === 'false' ? false : 'require',
    max: 10,
    idle_timeout: 20, // seconds; release idle connections instead of holding them forever
    // Drizzle reads `timestamp` columns as UTC, so the session must write them as UTC too. On a
    // database set to local time (e.g. Asia/Karachi) every defaultNow() value was stored hours
    // ahead and read back in the future ("just now" for ever, wrong ordering against JS dates).
    connection: { TimeZone: 'UTC' },
  });

if (process.env.NODE_ENV !== 'production') globalForDb.pgClient = client;

// Create the database instance
export const db = drizzle(client, { schema });

// Test the database connection
export async function testConnection() {
  try {
    await client`SELECT 1`;
    console.log('Database connection successful');
    return true;
  } catch (error) {
    console.error('Database connection failed:', error);
    return false;
  }
}

// Initialize database with migrations
export async function initializeDatabase() {
  try {
    await migrate(db, { migrationsFolder: './drizzle' });
    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Database initialization failed:', error);
    throw error;
  }
}

// Close the connection (call this when shutting down the app)
export async function closeConnection() {
  await client.end();
}
