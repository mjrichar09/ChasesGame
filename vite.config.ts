import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages serves a project site from a subdirectory named after the
  // repo, so built asset URLs have to carry it. Reading `process.env` is fine
  // here — this file runs in Node at build time, not in the browser.
  base: process.env.GITHUB_ACTIONS ? '/ChasesGame/' : '/',
  server: { port: 5174, host: true },
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        // three.js and Rapier change only on a dependency bump, so they get
        // their own chunks and stay cached across game updates.
        manualChunks: (id: string) => {
          if (id.includes('node_modules/three')) return 'three';
          if (id.includes('node_modules/@dimforge/rapier3d-compat')) return 'rapier';
          return undefined;
        },
      },
    },
  },
});
