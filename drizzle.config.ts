import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './libs/schema.js',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  verbose: true,
  strict: true,
});
