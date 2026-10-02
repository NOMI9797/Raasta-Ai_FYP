const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // pdf-parse (pdfjs) breaks when bundled by webpack; load it from node_modules at runtime
    serverComponentsExternalPackages: ["pdf-parse"],
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
