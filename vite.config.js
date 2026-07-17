import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages 프로젝트 사이트 경로: https://flyest1.github.io/sajo-game/
  base: '/sajo-game/',
  build: {
    outDir: 'dist',
    assetsInlineLimit: 8192,
  },
  server: { host: true },
});
