import { defineConfig } from 'vite';

// In development, /api/* is proxied to the Express server (see scripts/dev.mjs).
// In production the Express server serves dist/ itself, so no proxy is needed.
export default defineConfig({
  server: {
    host: '0.0.0.0',
    proxy: {
      '/api': { target: process.env.API_URL ?? 'http://localhost:3000', changeOrigin: true },
    },
  },
});
