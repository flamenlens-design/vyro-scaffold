/** @type {import('next').NextConfig} */
const nextConfig = {
  // Required for the Docker build: produces a self-contained server.js with
  // only the files that are actually needed at runtime, instead of relying
  // on a full node_modules copy.
  output: "standalone",
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**" },
    ],
  },
};

module.exports = nextConfig;
