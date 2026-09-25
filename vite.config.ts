import { defineConfig } from 'vite';

// CI (both the Pages and Android workflows) sets these automatically; a local
// build falls back to "dev" so the label is always defined.
const runNumber = process.env.GITHUB_RUN_NUMBER;
const sha = process.env.GITHUB_SHA;
const buildLabel = runNumber ? `build ${runNumber} · ${sha ? sha.slice(0, 7) : 'dev'}` : 'dev';

// Relative base so the same build works inside Capacitor's WebView and on any static host.
export default defineConfig({
  base: './',
  define: {
    __BUILD_LABEL__: JSON.stringify(buildLabel),
  },
  build: {
    target: 'es2020',
    outDir: 'dist',
  },
});
