import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The panel is served by the license server in production; in development API calls are proxied to it.
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 3100,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:7000', changeOrigin: true, timeout: 0, proxyTimeout: 0 },
    },
  },
});
