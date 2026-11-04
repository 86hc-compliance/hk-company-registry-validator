import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cloudflare } from '@cloudflare/vite-plugin';

export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === 'node' ? [] : [cloudflare()])],
  build: { outDir: 'dist/client' },
  server: { allowedHosts: ['localhost'] },
}));
