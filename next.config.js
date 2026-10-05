const nextConfig = {
  // NEXT_DIST_DIR lets a second server (a speed check, or `npm run serve`) build into its own folder
  // without touching the `.next` folder of the dev server that is already running.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  reactStrictMode: true,
  env: {
    // QUERY_DEVTOOLS=true in .env.local shows the React Query panel (see components/QueryProvider.js)
    NEXT_PUBLIC_QUERY_DEVTOOLS: process.env.QUERY_DEVTOOLS === "true" ? "true" : "false",
  },
  // `npm run dev` throws away a compiled screen about a minute after you leave it (and keeps only a few),
  // so coming back to it compiles it again. Keep them: it costs some memory, and saves seconds on each return.
  onDemandEntries: {
    maxInactiveAge: 30 * 60 * 1000,
    pagesBufferLength: 30,
  },
  experimental: {
    // instrumentation.js starts the hiring worker together with the web server (Next 14 needs this flag).
    // Set HIRING_WORKER_MODE=external to run the worker yourself instead.
    instrumentationHook: true,
    // Server-side packages are loaded from node_modules at runtime instead of being bundled by webpack.
    // pdf-parse (pdfjs) breaks when bundled; the others are large, so bundling them only slows every compile.
    serverComponentsExternalPackages: [
      "pdf-parse",
      "drizzle-orm", "postgres", "ioredis", "redis", "openai", "groq-sdk", "bcryptjs", "apify-client", "stripe", "mailgun.js", "nodemailer", "@deepgram/sdk", "axios", "form-data", "mammoth", "ws",
    ],
  },
  images: {
    domains: [
      // NextJS <Image> component needs to whitelist domains for src={}
      "lh3.googleusercontent.com",
      "pbs.twimg.com",
      "images.unsplash.com",
      "logos-world.net",
      "media.licdn.com", // LinkedIn profile images
      "static.licdn.com", // LinkedIn static assets
    ],
  },
};

module.exports = nextConfig;
