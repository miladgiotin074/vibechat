import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // In development the API is reached through this dev server (same origin): one HTTPS tunnel is
  // then enough to open the app inside Telegram, and there is no CORS to configure.
  server: {
    port: 5173,
    host: true,
    allowedHosts: true,
    proxy: {
      '/v1': { target: 'http://localhost:4000', ws: true, changeOrigin: false },
      '/media': { target: 'http://localhost:4000' },
    },
  },
  // Testing inside Telegram goes through a tunnel, and a free tunnel cannot deliver the hundreds of
  // separate module requests the dev server makes (the app then hangs half-loaded on a black
  // screen). `npm run build && npm run preview` serves the same few bundled files instead, on the
  // same port and with the same API proxy, so the tunnel needs no change.
  preview: {
    port: 5173,
    host: true,
    allowedHosts: true,
    proxy: {
      '/v1': { target: 'http://localhost:4000', ws: true, changeOrigin: false },
      '/media': { target: 'http://localhost:4000' },
    },
  },
  build: {
    target: 'es2020',
    sourcemap: false,
    rollupOptions: {
      output: {
        // Long-term caching: vendor code changes rarely, the app often.
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined;
          if (/[\/](react|react-dom|scheduler)[\/]/.test(id)) return 'react';
          if (id.includes('@tma.js')) return 'tg';
          if (/[\/](motion|framer-motion|motion-dom|motion-utils)[\/]/.test(id)) return 'motion';
          if (id.includes('@tanstack')) return 'query';
          return 'vendor';
        },
      },
    },
  },
});
