import type { NextConfig } from 'next';

const config: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  images: { unoptimized: true },
  // don't write AGENTS.md into the project on `next dev`
  agentRules: false,
  // Local development: the API stores photos on disk and links them as /media/...
  async rewrites() {
    if (process.env.NODE_ENV === 'production') return [];
    return [{ source: '/media/:path*', destination: `${process.env.BACKEND_URL ?? 'http://localhost:4000'}/media/:path*` }];
  },
};

export default config;
