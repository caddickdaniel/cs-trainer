import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the API runs on :9090 and is proxied so the browser only ever
// talks to one origin (same as production, where Express serves client/dist).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: `http://localhost:${process.env.API_PORT || 9090}`, changeOrigin: false },
    },
  },
  build: { outDir: 'dist', sourcemap: true },
});
