import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Prevent Next.js from bundling these — they use Node.js crypto / native modules
  serverExternalPackages: ['@line/bot-sdk', '@google/genai'],
};

export default nextConfig;
