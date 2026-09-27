import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';

// Version scheme shared with android/app/build.gradle: v1.0.<N> where N is
// the number of commits on main. Computed the same way in both places so a
// web build and an APK build from the same commit show the same version,
// regardless of which CI workflow (and its own GITHUB_RUN_NUMBER) built them.
function commitCount(): string {
  try {
    return execSync('git rev-list --count HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'dev';
  }
}

const sha = process.env.GITHUB_SHA;
const shaShort = sha ? sha.slice(0, 7) : 'dev';
const n = commitCount();
const buildLabel = n === 'dev' ? 'dev' : `v1.0.${n} (${shaShort})`;

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
