import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        timeout: 160000,
        proxyTimeout: 160000,
      },
    },
  },
});
