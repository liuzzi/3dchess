import { defineConfig } from 'vite';
import { resolve } from 'path';

/**
 * Portal build config — produces a self-contained game bundle
 * with relative asset paths, suitable for iframe embedding on
 * game portal sites (addictinggames.com, etc.).
 *
 * Usage: npx vite build --config vite.config.portal.ts
 * Or via: npm run build:portal
 */
export default defineConfig({
  root: '.',
  base: './',
  build: {
    outDir: 'dist-portal',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        playOnline: resolve(__dirname, 'play-chess-online/index.html'),
      },
    },
  },
  appType: 'mpa',
});
