import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev, /api is proxied to a local indexer (indexer/src/main.ts).
export default defineConfig({
  plugins: [react()],
  server: {
    // The browser-side verifier imports the indexer's derivation module (../indexer/src/derive.ts).
    fs: { allow: ['..'] },
    proxy: {
      '/api': {
        target: process.env.INDEXER_URL ?? 'http://localhost:8787',
        rewrite: (p) => p.replace(/^\/api/, ''),
      },
    },
  },
});
