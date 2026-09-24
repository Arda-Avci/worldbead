import { defineConfig } from 'vite';

// Relative base so the same build works inside Capacitor's WebView and on any static host.
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    outDir: 'dist',
  },
});
