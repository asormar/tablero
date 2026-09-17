import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { VitePWA, type VitePWAOptions } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';

const srcDir = fileURLToPath(new URL('./src', import.meta.url));
const sharedDir = fileURLToPath(new URL('../../packages/shared/src', import.meta.url));

/**
 * Manifiesto de la PWA (punto 7 de la fase 4).
 *
 * El `share_target` no está en los tipos de Workbox, así que el objeto se arma
 * sin tipo y se ajusta al declarar la opción del plugin. `action: '/?share=1'`
 * porque la app es una SPA servida desde la raíz.
 */
const pwaManifest = {
  name: 'Tablero — tableros visuales',
  short_name: 'Tablero',
  description:
    'Tableros visuales con tarjetas: notas, enlaces, archivos, tareas, mapas y dibujos, con colaboración en tiempo real.',
  lang: 'es',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  orientation: 'any',
  theme_color: '#2f6fc9',
  background_color: '#f4f4f2',
  categories: ['productivity', 'utilities'],
  icons: [
    { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
  share_target: {
    action: '/?share=1',
    method: 'GET',
    enctype: 'application/x-www-form-urlencoded',
    params: { title: 'title', text: 'text', url: 'url' },
  },
};

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // El registro lo hace `src/pwa/register.ts` (sin `workbox-window`).
      injectRegister: false,
      includeAssets: ['icons/apple-touch-icon.png'],
      manifest: pwaManifest as unknown as NonNullable<VitePWAOptions['manifest']>,
      workbox: {
        // Caché de la aplicación (precache del build). La API y la colaboración
        // quedan afuera a propósito: son datos vivos y van siempre a la red.
        globPatterns: ['**/*.{js,css,html,png,svg,woff,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/collab\//],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
      },
      devOptions: {
        // En desarrollo no se registra el service worker: el HMR quedaría
        // sirviendo módulos cacheados.
        enabled: false,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': srcDir,
      // El paquete compartido se consume como fuente TypeScript (main: ./src/index.ts).
      '@tablero/shared': `${sharedDir}/index.ts`,
    },
  },
  server: {
    port: Number(process.env.PORT ?? 5173),
    strictPort: false,
    proxy: {
      // Evita CORS en desarrollo: el cliente usa rutas relativas `/api/**`.
      '/api': { target: 'http://localhost:8787', changeOrigin: true },
      '/collab': { target: 'ws://localhost:8787', ws: true },
    },
  },
  // La vista previa del build necesita el mismo proxy que el servidor de
  // desarrollo: si no, `pnpm preview` sirve una app que no habla con la API.
  preview: {
    port: Number(process.env.PREVIEW_PORT ?? 4173),
    strictPort: false,
    proxy: {
      '/api': { target: 'http://localhost:8787', changeOrigin: true },
      '/collab': { target: 'ws://localhost:8787', ws: true },
    },
  },
  optimizeDeps: {
    // El editor se carga bajo demanda; sus dependencias se pre-empaquetan al
    // arrancar para que el primer doble clic en una nota no recargue la página.
    // `@tiptap/pm` no expone el subpath "." (solo ./state, ./view…), así que se
    // listan los módulos concretos que usa el editor.
    include: [
      '@tiptap/core',
      '@tiptap/react',
      '@tiptap/starter-kit',
      '@tiptap/extension-collaboration',
      '@tiptap/extension-placeholder',
      '@tiptap/pm/state',
      '@tiptap/pm/view',
      '@tiptap/pm/model',
      '@tiptap/pm/transform',
      '@tiptap/pm/commands',
      '@tiptap/pm/keymap',
      '@tiptap/pm/schema-list',
      'y-prosemirror',
    ],
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      output: {
        /**
         * Un chunk de arranque por debajo del umbral de 500 kB: React, Yjs,
         * Zod y los iconos se llevan casi todo el peso, así que cada familia va
         * en su propio archivo (además, se cachean entre despliegues). Leaflet,
         * perfect-freehand y pdfjs quedan en chunks propios: los tres se cargan
         * solo cuando hay una tarjeta que los usa.
         */
        manualChunks(id: string): string | undefined {
          if (!id.includes('node_modules')) return undefined;
          // `y-prosemirror` va con el editor: si no, el chunk de colaboración
          // dependería del de ProseMirror y el editor del de colaboración (chunk
          // circular).
          if (id.includes('@tiptap') || id.includes('/prosemirror') || id.includes('y-prosemirror')) {
            return 'vendor-editor';
          }
          if (id.includes('react-dom') || id.includes('/react/') || id.includes('scheduler') || id.includes('use-sync-external-store')) {
            return 'vendor-react';
          }
          if (id.includes('/yjs') || id.includes('lib0') || id.includes('@hocuspocus') || id.includes('y-protocols')) {
            return 'vendor-collab';
          }
          if (id.includes('zod')) return 'vendor-zod';
          if (id.includes('lucide-react')) return 'vendor-icons';
          if (id.includes('perfect-freehand')) return 'vendor-sketch';
          if (id.includes('leaflet')) return 'vendor-leaflet';
          if (id.includes('pdfjs-dist')) return 'vendor-pdf';
          return 'vendor';
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    passWithNoTests: false,
  },
});
