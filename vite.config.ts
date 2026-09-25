import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' so the built site works from any folder (GitHub Pages, local file server)
export default defineConfig({
  base: './',
  plugins: [react()],
  worker: { format: 'es' },
});
