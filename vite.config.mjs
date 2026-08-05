import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.join(projectRoot, 'src', 'game'),
  base: './',
  publicDir: false,
  plugins: [
    vue(),
    viteSingleFile({ removeViteModuleLoader: true })
  ],
  build: {
    outDir: path.join(projectRoot, 'release', 'html'),
    emptyOutDir: false,
    target: 'es2020',
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    modulePreload: false,
    sourcemap: false,
    reportCompressedSize: false
  }
});
