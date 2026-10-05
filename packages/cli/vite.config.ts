import fs from 'fs';
import path from 'path';

import { visualizer } from 'rollup-plugin-visualizer';
import { defineConfig } from 'vite';

const pkg = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8'),
);

export default defineConfig({
  define: {
    __CLI_VERSION__: JSON.stringify(pkg.version),
  },
  ssr: { noExternal: true, external: ['@actual-app/api'] },
  build: {
    ssr: true,
    target: 'node22',
    outDir: path.resolve(__dirname, 'dist'),
    emptyOutDir: true,
    lib: {
      entry: {
        cli: path.resolve(__dirname, 'src/index.ts'),
        'server-runner': path.resolve(__dirname, 'src/server-runner.ts'),
        'sync-worker': path.resolve(__dirname, 'src/sync-worker.ts'),
        'backup-worker': path.resolve(__dirname, 'src/backup-worker.ts'),
        'budget-snapshot': path.resolve(__dirname, 'src/budget-snapshot.ts'),
      },
      formats: ['es'],
    },
    rollupOptions: {
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name]-[hash].js',
        banner: chunk => (chunk.isEntry ? '#!/usr/bin/env node' : ''),
      },
    },
  },
  plugins: [visualizer({ template: 'raw-data', filename: 'dist/stats.json' })],
  test: {
    globals: true,
    include: ['src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    testTimeout: 10_000,
  },
});
