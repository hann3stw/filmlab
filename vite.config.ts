import { defineConfig, type Plugin } from 'vite'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import pkg from './package.json' with { type: 'json' }

/** All files in a folder, recursively, as paths relative to that folder. */
function listFiles(dir: string, base = dir): string[] {
  return readdirSync(dir).flatMap(name => {
    const full = join(dir, name)
    return statSync(full).isDirectory() ? listFiles(full, base) : [relative(base, full).split('\\').join('/')]
  })
}

/**
 * Generates dist/sw.js from sw/sw.template.js, filling in the list of every
 * built file. The version is a hash of all file names (which contain content
 * hashes), so ANY change produces a new service worker → the app updates.
 */
function serviceWorker(): Plugin {
  return {
    name: 'filmlab-service-worker',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const built = Object.keys(bundle).filter(f => !f.endsWith('.map'))
      const pub = listFiles(resolve(__dirname, 'public'))
      const files = [...new Set(['./', 'index.html', 'diagnostics.html', ...built, ...pub])]
        .filter(f => f !== 'sw.js' && f !== 'CNAME' && !f.startsWith('.well-known/'))
        // Fonts: Chrome only needs .woff2, and only the latin subsets for DE/EN.
        // (Anything else is still cached on first use by the service worker.)
        .filter(f => !/\.(woff|ttf)$/.test(f) && !(/\.woff2$/.test(f) && !/-latin(-ext)?-/.test(f)))
      const version = pkg.version + '-' + createHash('sha1').update(files.sort().join('|')).digest('hex').slice(0, 8)
      const source = readFileSync(resolve(__dirname, 'sw/sw.template.js'), 'utf8')
        .replace('__VERSION__', version)
        .replace('__PRECACHE__', JSON.stringify(files, null, 2))
      this.emitFile({ type: 'asset', fileName: 'sw.js', source })
    },
  }
}

// Vite = the tool that bundles our TypeScript into plain JS for the browser.
export default defineConfig({
  // './' = all asset URLs are relative. That way the same build works both at
  // https://<user>.github.io/filmlab/ and at a domain root (Phase 4).
  base: './',
  build: {
    target: 'es2022',
    rollupOptions: {
      // Two pages: the app and the diagnostics (Phase 0) page
      input: {
        main: resolve(__dirname, 'index.html'),
        diagnostics: resolve(__dirname, 'diagnostics.html'),
      },
    },
  },
  define: {
    // Lets the app show its version number (from package.json).
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [serviceWorker()],
})
