import { defineConfig } from 'tsup';
export default defineConfig({
  entry: ['src/main.ts', 'src/create-admin.ts'],
  format: ['esm'],
  target: 'node20',
  outDir: 'dist',
  clean: true,
  // Bundle workspace packages; keep npm dependencies external.
  noExternal: [/^@startup\//],
});
