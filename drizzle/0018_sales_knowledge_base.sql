-- Sales knowledge base (RAG): what the sales agent knows about your company, split into chunks
-- with an embedding each. Needs the pgvector extension (Neon, Supabase and RDS have it; locally
-- `brew install pgvector`, or build it for your Postgres version).
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS "kb_documents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL CONSTRAINT "kb_documents_user_id_users_id_fk" REFERENCES "users"("id") ON DELETE cascade,
  "title" text NOT NULL,
  "category" varchar(30) DEFAULT 'other' NOT NULL,
  "kind" varchar(10) DEFAULT 'note' NOT NULL,
  "source" text,
  "content" text NOT NULL,
  "status" varchar(20) DEFAULT 'ready' NOT NULL,
  "error" text,
  "chunk_count" integer DEFAULT 0 NOT NULL,
  "is_sample" boolean DEFAULT false NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "kb_documents_user_idx" ON "kb_documents" ("user_id","updated_at");

CREATE TABLE IF NOT EXISTS "kb_chunks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "document_id" uuid NOT NULL CONSTRAINT "kb_chunks_document_id_kb_documents_id_fk" REFERENCES "kb_documents"("id") ON DELETE cascade,
  "user_id" text NOT NULL CONSTRAINT "kb_chunks_user_id_users_id_fk" REFERENCES "users"("id") ON DELETE cascade,
  "chunk_index" integer NOT NULL,
  "content" text NOT NULL,
  "embedding" vector(384) NOT NULL,
  -- keyword side of the hybrid search
  "tsv" tsvector GENERATED ALWAYS AS (to_tsvector('english', "content")) STORED,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "kb_chunks_user_idx" ON "kb_chunks" ("user_id");
CREATE INDEX IF NOT EXISTS "kb_chunks_document_idx" ON "kb_chunks" ("document_id","chunk_index");
CREATE INDEX IF NOT EXISTS "kb_chunks_embedding_idx" ON "kb_chunks" USING hnsw ("embedding" vector_cosine_ops);
CREATE INDEX IF NOT EXISTS "kb_chunks_tsv_idx" ON "kb_chunks" USING gin ("tsv");
