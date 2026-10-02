import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import * as schema from './schema';

// Create the connection
const connectionString = process.env.DATABASE_URL!;
// Managed Postgres needs SSL; set DATABASE_SSL=false for a local database
const client = postgres(connectionString, {
  ssl: process.env.DATABASE_SSL === 'false' ? false : 'require',
});

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
