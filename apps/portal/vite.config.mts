/// <reference types='vitest' />
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/**
 * One portal codebase, three builds (TAD §13, design review point 5):
 *
 *   --mode investor   public site: investor screens only
 *   --mode staff      internal site: back-office screens only
 *   default           demo: both, with the demo controls
 *
 * The excluded portal's route module is swapped for an empty one, so its views never
 * enter the module graph and no chunk of them is emitted.
 */
export default defineConfig(({ mode }) => {
  const portal = loadEnv(mode, import.meta.dirname, 'VITE_').VITE_PORTAL ?? 'all';
  const alias = [
    ...(portal === 'investor'
      ? [{ find: /^\.\/staff-routes$/, replacement: here('./src/router/staff-routes.none.ts') }]
      : []),
    ...(portal === 'staff'
      ? [
          {
            find: /^\.\/investor-routes$/,
            replacement: here('./src/router/investor-routes.none.ts'),
          },
        ]
      : []),
  ];

  return {
    root: import.meta.dirname,
    cacheDir: '../../node_modules/.vite/apps/portal',
    server: {
      port: 4400,
      host: 'localhost',
      // Same-origin in development, as behind TCB's gateway in production: no CORS,
      // and tokens never go to a second origin.
      proxy: {
        '/api/identity': { target: 'http://localhost:3101', rewrite: (p) => p.replace(/^\/api\/identity/, '') },
        '/api/investor': { target: 'http://localhost:3102', rewrite: (p) => p.replace(/^\/api\/investor/, '') },
        '/api/auction': { target: 'http://localhost:3103', rewrite: (p) => p.replace(/^\/api\/auction/, '') },
      },
    },
    preview: { port: 4410, host: 'localhost' },
    plugins: [vue(), nxViteTsPaths()],
    resolve: { alias },
    build: {
      outDir: '../../dist/apps/portal',
      emptyOutDir: true,
      reportCompressedSize: true,
    },
    test: {
      name: 'portal',
      watch: false,
      globals: true,
      environment: 'jsdom',
      include: ['src/**/*.{test,spec}.ts'],
      reporters: ['default'],
      coverage: { reportsDirectory: '../../coverage/apps/portal', provider: 'v8' as const },
    },
  };
});
