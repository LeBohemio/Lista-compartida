import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons/icon-192.png', 'icons/icon-512.png'],
      manifest: {
        name: 'Listas en Común',
        short_name: 'En Común',
        description: 'Listas de notas y gastos compartidos entre varias personas',
        theme_color: '#4f46e5',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        // El motor de OCR (worker + core wasm + datos de idioma) pesa varios MB:
        // no lo precacheamos al instalar la PWA, se descarga la primera vez que
        // se usa y a partir de ahí queda cacheado (runtimeCaching de abajo).
        globIgnores: ['**/tesseract-core/**', '**/tessdata/**', '**/tesseract/**'],
        navigateFallbackDenylist: [/^\/api/],
        runtimeCaching: [
          {
            urlPattern: /\/(tesseract|tesseract-core|tessdata)\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'ocr-engine-assets',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 180 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
})
