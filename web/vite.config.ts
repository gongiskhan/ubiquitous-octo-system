import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3981,
    proxy: {
      '/api': {
        target: 'http://localhost:3892',
        changeOrigin: true,
      },
      '/webhook': {
        target: 'http://localhost:3892',
        changeOrigin: true,
      },
      '/preview': {
        target: 'http://localhost:3892',
        changeOrigin: true,
      },
      '/data': {
        target: 'http://localhost:3892',
        changeOrigin: true,
      },
    },
  },
});
