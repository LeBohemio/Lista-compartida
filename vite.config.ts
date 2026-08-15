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
      // injectManifest (en vez de generateSW): necesitamos un Service
      // Worker escrito a mano para poder reaccionar a los avisos push que
      // llegan del servidor (evento "push") y a que los toquen (evento
      // "notificationclick") — generateSW no permite añadir ese código
      // propio, solo genera el cacheo. El cacheo de siempre (precache de la
      // app + las dos rutas en caliente para el OCR y los avatares) ahora
      // vive dentro de src/sw.ts en vez de aquí.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        globIgnores: ['**/tesseract-core/**', '**/tessdata/**', '**/tesseract/**', '**/avatars/**'],
      },
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
    }),
  ],
})
