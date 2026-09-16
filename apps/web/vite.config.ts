import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const srcDir = fileURLToPath(new URL('./src', import.meta.url));
const sharedDir = fileURLToPath(new URL('../../packages/shared/src', import.meta.url));

export default defineConfig({
  plugins: [react()],
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
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    passWithNoTests: false,
  },
});
