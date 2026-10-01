import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    // This code ships inside the desktop app (tauri/) and loads from disk, not
    // over a network, so Vite's 500 kB warning (meant for websites) doesn't apply.
    chunkSizeWarningLimit: 1600,
  },
});
