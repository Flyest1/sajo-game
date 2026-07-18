import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // GitHub Pages 프로젝트 사이트 경로: https://flyest1.github.io/sajo-game/
  base: '/sajo-game/',
  build: {
    outDir: 'dist',
    assetsInlineLimit: 8192,
  },
  server: { host: true },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png'],
      manifest: {
        name: '사조영웅전: 강호의 별',
        short_name: '강호의 별',
        description: '김용 원작 팬메이드 무협 SRPG (AI 제작 데모)',
        lang: 'ko',
        theme_color: '#1b1712',
        background_color: '#1b1712',
        display: 'standalone',
        orientation: 'any',
        scope: '/sajo-game/',
        start_url: '/sajo-game/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // 빌드 산출물 전체를 프리캐시 → 오프라인 플레이 지원
        globPatterns: ['**/*.{js,css,html,png,svg,json,woff2}'],
        navigateFallback: '/sajo-game/index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
});
