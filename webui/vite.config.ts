import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  build: { sourcemap: true },
  assetsInclude: ['**/*.nnue', '**/*.bin', '**/*.wasm'],
  resolve: {
    extensions: [
      '.ts',
      '.tsx',
      '.js',
      '.jsx',
      '.mjs',
      '.cjs',
      '.mts',
      '.json',
    ],
  },
});
