// Loads .env.local then .env for processes that run outside Next.js (worker, interview engine).
// Import this first in those entry files. Existing environment variables are never overridden.
import dotenv from "dotenv";

dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ path: ".env", quiet: true });
