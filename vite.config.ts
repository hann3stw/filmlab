import { defineConfig } from 'vite'
import pkg from './package.json' with { type: 'json' }

// Vite = the tool that bundles our TypeScript into plain JS for the browser.
export default defineConfig({
  // './' = all asset URLs are relative. That way the same build works both at
  // https://<user>.github.io/filmlab/ (project page) and at a domain root
  // (needed later for the Android app / Digital Asset Links in Phase 4).
  base: './',
  build: {
    target: 'es2022',
  },
  define: {
    // Lets the app show its version number (from package.json).
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
})
