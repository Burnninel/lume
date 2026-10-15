import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: './',
  plugins: [react(), VitePWA({
    registerType: 'prompt',
    includeAssets: ['favicon.svg'],
    manifest: {
      name: 'Lume — espaço para suas ideias', short_name: 'Lume',
      description: 'Escreva, leia e organize seus documentos Markdown.',
      theme_color: '#f7f8f5', background_color: '#f7f8f5', display: 'standalone',
      start_url: './', scope: './', lang: 'pt-BR',
      icons: [{ src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
    },
    workbox: { clientsClaim: true, globPatterns: ['**/*.{js,css,html,svg,woff,woff2,ttf}'], maximumFileSizeToCacheInBytes: 8 * 1024 * 1024, navigateFallback: 'index.html' },
  })],
  build: { chunkSizeWarningLimit: 1200 },
})
