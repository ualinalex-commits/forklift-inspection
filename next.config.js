/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  turbopack: {},
  webpack: (config) => {
    // pdfjs-dist optionally requires 'canvas' in Node.js; stub it out for browser bundles
    config.resolve.alias.canvas = false;
    return config;
  },
};

module.exports = nextConfig;
