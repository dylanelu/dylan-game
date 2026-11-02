import { defineConfig } from 'vite';

// relative base so the build works from a GitHub Pages project path
export default defineConfig({
  base: './',
  // dev/ holds tool pages (rig viewer); only index.html ships
  build: { target: 'es2022', assetsInlineLimit: 0 },
});
