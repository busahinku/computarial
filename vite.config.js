import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'

// Inlines the brand wordmark once as an SVG <symbol>; the page references it with <use>.
const wordmark = () => ({
  name: 'wordmark-symbol',
  transformIndexHtml(html) {
    const svg = readFileSync('public/brand/computarial-black.svg', 'utf8')
    const paths = svg.match(/<path[^>]*\/>/g).join('').replace(/ fill="[^"]*"/g, '')
    return html.replace('<!-- wordmark -->', `<symbol id="wordmark" viewBox="0 0 585 115">${paths}</symbol>`)
  },
})

export default defineConfig({
  base: './',
  // KTX2Loader resolves its Basis transcoder (JS + WASM) through import.meta.url,
  // so Rollup fingerprints it into /assets with no copy step.
  plugins: [wordmark()],
  // Pre-bundling would break KTX2Loader's import.meta.url transcoder path in dev.
  optimizeDeps: { exclude: ['three'] },
  assetsInclude: ['**/*.glb', '**/*.ktx2'],
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          post: ['postprocessing'],
          motion: ['gsap', 'lenis', 'howler'],
        },
      },
    },
  },
})
