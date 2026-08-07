import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// A deployed bundle carries its source revision.  Keeping this in the bundle (rather
// than in mutable storage) makes it possible to tell a stale PWA shell from main.
const sourceRevision=(process.env.GITHUB_SHA||process.env.APP_REVISION||'local').slice(0,7);
const appVersion=`R21-${sourceRevision}`;

export default defineConfig({
  // GitHub Pages 프로젝트 사이트 경로: https://flyest1.github.io/sajo-game/
  base: '/sajo-game/',
  build: {
    outDir: 'dist',
    assetsInlineLimit: 8192,
  },
  server: { host: true },
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  plugins: [
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png'],
      manifest: {
        name: '강호의 별 — 통합 강호연대기',
        short_name: '강호의 별',
        description: '시대와 인물 계보를 잇는 비공식·비영리 팬메이드 무협 SRPG',
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
        globIgnores: ['portraits/**/*'],
        navigateFallback: '/sajo-game/index.html',
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        runtimeCaching: [
          {
            urlPattern: ({url}) => url.pathname.includes('/portraits/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'wuxia-portraits-v2',
              expiration: { maxEntries: 240, maxAgeSeconds: 60 * 60 * 24 * 90 },
            },
          },
        ],
      },
    }),
  ],
});
