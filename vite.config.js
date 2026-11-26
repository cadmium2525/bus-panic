import { defineConfig } from 'vite';

// GitHub Pages のリポジトリ配下 URL（/bus-panic/ など）でも動くように相対パスで出力
export default defineConfig({
  base: './',
  build: {
    target: 'es2019',
    chunkSizeWarningLimit: 1200,
    assetsInlineLimit: 0,
  },
  server: {
    host: true,
  },
});
