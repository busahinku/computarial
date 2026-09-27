# Computarial

Cinematic landing page for Computarial: intentional technology for focus and childhood.
One WebGL canvas tells the story in five chapters while a thin, accessible DOM layer carries the copy.

**Stack:** Vite 7 (Rollup) · vanilla ES modules · Three.js r186 · postprocessing · GSAP + ScrollTrigger + SplitText · Lenis · Howler · GLB (meshopt) · KTX2 (Basis) · WebP

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # static site in /dist
npm run preview    # serve /dist locally
```

Node 20+ is required. `npm run assets` and `npm run audio` rebuild the generated media (see below); their output is committed, so a fresh clone builds without them.

## Environment

| Variable | Purpose |
| --- | --- |
| `VITE_WAITLIST_ENDPOINT` | URL that accepts `POST {"email": "..."}` as JSON (Formspree, Basin, a Lambda). Without it the form shows "Signups open soon". |
| `VITE_FLOWTRACK_URL` | Download link for the "Download Flowtrack" button. Without it the button scrolls to the waitlist. |

Copy `.env.example` to `.env.production` and fill it in before `npm run build` or `npm run deploy`.

## Architecture

```
index.html                 DOM layer: copy, nav, waitlist, footer (all real, accessible HTML)
src/
  main.js                  Boot: preloader -> core assets -> pre-warm -> render loop -> story assets
  core/store.js            `state` (numbers GSAP writes, WebGL reads), event bus, device tier
  webgl/
    App.js                 Renderer, camera spline, post chain, render loop, quality governor
    AssetManager.js        Staged loading (GLB, KTX2, fonts, audio) and GPU pre-warming
    world/                 Sky, Sanctuary, Feathers, Armillary, Atmosphere, Device
  animations/
    ScrollController.js    Lenis + one master ScrollTrigger timeline that scrubs `state`
  ui/                      Preloader, Interface (reveals, magnetic buttons, card tilt, form)
  audio/Sound.js           Howler soundscape
  styles/main.css          Tokens, glass surfaces, layout per chapter, responsive rules
scripts/
  build-assets.mjs         Procedural textures -> KTX2, device model -> GLB, favicon
  build-audio.mjs          Synthesized ambient pad, chime, whoosh, tick -> WebM/Opus + MP3
```

### How scroll drives the scene

There is exactly one `requestAnimationFrame` on the page: GSAP's ticker. Each frame runs, in order:

1. GSAP updates its tweens.
2. `lenis.raf()` advances the smoothed scroll and calls `ScrollTrigger.update()`.
3. The master timeline, scrubbed to scroll progress, writes plain numbers into `state` (`camT`, `formation`, `chaos`, `flow`, `fold`, `halo`...).
4. `App.tick()` reads `state`, moves the camera along a Catmull-Rom spline, morphs feather formations, and renders.

Timeline positions come from real section offsets, so a chapter transition plays exactly while its section scrolls into view. The WebGL side never touches the DOM, and the DOM never touches Three.js; `state` is the only contract between them.

### Loading and pre-warming

`AssetManager` loads in two stages:

- **core** blocks the preloader: marble and cloud KTX2 textures, fonts.
- **story** streams in behind the hero: the device GLB and the audio.

After each stage, `prewarm()` makes every object visible and unculled, runs `renderer.compileAsync()`, uploads every texture with `initTexture()`, and renders one frame through the full post chain. Shader programs, textures and vertex buffers are therefore on the GPU before any chapter needs them, so no chapter hitches on first view.

### Performance

- Resolution follows a pixel budget (4.2 M pixels on desktop, 1.4 M on touch devices) instead of `devicePixelRatio` alone, so a phone, a 1080p monitor and a 4K or 5K display cost the GPU about the same. DOM text always stays at native resolution.
- Above 1920 px wide the whole UI scales with the viewport (`html { font-size: calc(100vw / 120) }`), so 4K shows the same composition, sharper.
- MSAA only below 1.25x; depth of field runs at 0.38 of the resolution.
- A quality governor compares frame intervals with the display's own refresh (60 or 120 Hz) and steps down in order: resolution, then depth of field, then a steady 60 fps cap.
- Resize is coalesced, and the canvas is sized to the large viewport (`100lvh`), so mobile URL bars never trigger a GPU re-allocation. Rotating a phone rebuilds the scroll map.
- Story assets build only after the intro flight, when the main thread is idle, so the opening never drops a frame.
- Feathers are two instanced meshes, depth-sorted in place each frame (about 100 instances, no allocations) for clean alpha blending.
- Backdrop blur is limited to four large surfaces; small chips use a solid pearl fill.
- A lost WebGL context (driver reset) falls back to the painted sky and resumes when the context returns.

Measured on an M4 Pro, every chapter holds 60 fps (p95 16.7 ms) with full effects at 1920x1080, 2560x1440 @2x (5K) and 3840x2160 (4K), with headroom for 120 Hz. Verified in Chromium and WebKit (Safari 26), on phone (portrait, landscape and rotation), tablet and desktop, and with reduced motion.

## /public

```
public/
  brand/computarial-black.svg   wordmark (inlined into the page as an SVG symbol at build time)
  brand/computarial-white.svg
  favicon.svg                   the "C" of the wordmark, adapts to dark UI
  images/og.webp                social preview, 1200x630
  models/eink-fold.glb          foldable e-ink device, EXT_meshopt_compression + quantized
  textures/marble.ktx2          ETC1S, tileable, with mipmaps
  textures/cloud.ktx2           UASTC + Zstd, with alpha
  audio/*.webm, *.mp3           Opus first, MP3 fallback
```

The Basis transcoder (`basis_transcoder.js` and `.wasm`) is not in `/public`: `KTX2Loader` resolves it through `import.meta.url`, and Rollup emits it into `/dist/assets` with a content hash.

### Replacing assets

- **Models:** export GLB, then compress with glTF Transform, for example
  `npx @gltf-transform/cli optimize in.glb public/models/out.glb --compress meshopt --texture-compress ktx2`.
  The loader already has the meshopt decoder and KTX2 support.
- **Textures:** KTX2 via `ktx2-encoder` (used in `scripts/build-assets.mjs`) or KTX-Software `toktx`.
- **Images:** WebP, for example with `sharp`.
- Register new files in the `manifest` in `src/webgl/AssetManager.js`, in the stage where they are first needed.

## Deploy to AWS S3 + CloudFront

### 1. Build

```bash
npm ci
npm run build
```

### 2. Bucket

Create a private bucket (Block Public Access on). Do not enable static website hosting; CloudFront reads it through Origin Access Control.

### 3. Upload with correct cache and content types

Hashed files can be cached forever; `index.html` must always revalidate.

```bash
BUCKET=s3://your-bucket

aws s3 sync dist $BUCKET --delete \
  --exclude "index.html" \
  --cache-control "public, max-age=31536000, immutable"

aws s3 cp dist/index.html $BUCKET/index.html \
  --cache-control "no-cache" --content-type "text/html; charset=utf-8"
```

Files in `models/`, `textures/`, `audio/` and `images/` keep stable names. Either version them on change or give them a shorter cache (for example `max-age=86400`) with a separate `sync --exclude/--include` pass.

Make sure these types are set (the CLI guesses most of them; set any it misses explicitly):

| Extension | Content-Type |
| --- | --- |
| `.wasm` | `application/wasm` |
| `.ktx2` | `image/ktx2` |
| `.glb` | `model/gltf-binary` |
| `.webm` | `audio/webm` |
| `.webp` | `image/webp` |
| `.woff2` | `font/woff2` |

```bash
aws s3 cp dist/textures $BUCKET/textures --recursive --content-type image/ktx2 \
  --cache-control "public, max-age=86400" --metadata-directive REPLACE
aws s3 cp dist/models $BUCKET/models --recursive --content-type model/gltf-binary \
  --cache-control "public, max-age=86400" --metadata-directive REPLACE
```

### 4. CloudFront

- Origin: the S3 bucket with **Origin Access Control**; apply the bucket policy CloudFront generates.
- Default root object: `index.html`.
- Viewer protocol policy: redirect HTTP to HTTPS. HTTP/2 and HTTP/3 on.
- Cache policy: `CachingOptimized`, with compression (Gzip + Brotli) on. KTX2, GLB and WASM compress well.
- Response headers policy (recommended): HSTS, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`.
- Custom domain: request an ACM certificate in `us-east-1`, add it and the alternate domain name, then point DNS at the distribution.

### 5. Invalidate on release

```bash
aws cloudfront create-invalidation --distribution-id YOUR_ID --paths "/index.html"
```

Hashed assets never need invalidation. Invalidate `/*` only if you changed files with stable names.

### Social preview and canonical URL

`index.html` points `canonical`, `og:url` and `og:image` at `https://busahin.com/computarial/`. GitHub Pages serves the project there because the account site uses the busahin.com custom domain; `busahinku.github.io/computarial/` redirects to it.

## Deploy to GitHub Pages (free)

```bash
npm run deploy
```

This builds and force-pushes `/dist` to the `gh-pages` branch of `origin` (`scripts/deploy.mjs`, plain git, no Actions needed). In the repository settings, Pages serves the `gh-pages` branch from `/`. `base: './'` keeps the build path-independent, so it works under `https://<user>.github.io/<repo>/`.

Pages is free for public repositories. To deploy from GitHub Actions instead, the CLI token needs the workflow scope: `gh auth refresh -s workflow`.

## Accessibility

- All copy is real HTML in reading order; the canvas is `aria-hidden`.
- Skip link, visible focus rings, labelled controls, `aria-live` form status.
- `prefers-reduced-motion`: no smooth-scroll hijack, no intro flight, no parallax, slowed ambient motion.
- `prefers-reduced-transparency`: glass surfaces become solid.
- Without WebGL2, the page falls back to the full story over a painted sky.
- Sound starts on its own after loading. Browsers hold audio until the first click or key press; the sound control shows "Tap for Sound" until then.
