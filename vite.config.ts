import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    port: 5183,
  },
  build: {
    target: 'es2022',
    cssMinify: 'lightningcss',
  },
});
