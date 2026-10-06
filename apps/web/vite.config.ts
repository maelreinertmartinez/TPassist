import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      // TPASSIST_API permet de viser un autre serveur (ex. un conteneur de test sur :3001).
      '/api': { target: process.env.TPASSIST_API ?? 'http://localhost:3000', changeOrigin: false },
    },
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 2000,
  },
});
