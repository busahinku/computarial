// Offline asset pipeline: procedural textures -> KTX2 (Basis), device model -> GLB (meshopt).
// Run with `npm run assets`. Outputs land in /public and are committed.
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import sharp from 'sharp'
import { encodeToKTX2 } from 'ktx2-encoder'
import { Document, NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { meshopt, prune } from '@gltf-transform/functions'
import { MeshoptEncoder } from 'meshoptimizer'
import { CylinderGeometry, PlaneGeometry } from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'

const OUT = new URL('../public/', import.meta.url)
await mkdir(new URL('textures/', OUT), { recursive: true })
await mkdir(new URL('models/', OUT), { recursive: true })

// Tileable value noise
const hash = (x, y, s) => {
  let h = (x * 374761393 + y * 668265263 + s * 982451653) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}
const smooth = (t) => t * t * (3 - 2 * t)
function noise(x, y, period, seed) {
  const xi = Math.floor(x), yi = Math.floor(y)
  const xf = smooth(x - xi), yf = smooth(y - yi)
  const p = (v) => ((v % period) + period) % period
  const a = hash(p(xi), p(yi), seed), b = hash(p(xi + 1), p(yi), seed)
  const c = hash(p(xi), p(yi + 1), seed), d = hash(p(xi + 1), p(yi + 1), seed)
  return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf
}
function fbm(u, v, base, octaves, seed) {
  let sum = 0, amp = 0.5, freq = base
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise(u * freq, v * freq, freq, seed + o)
    freq *= 2
    amp *= 0.5
  }
  return sum
}

async function toKTX2(rgba, size, file, options) {
  const png = await sharp(rgba, { raw: { width: size, height: size, channels: 4 } }).png().toBuffer()
  const ktx2 = await encodeToKTX2(new Uint8Array(png), {
    generateMipmap: true,
    isPerceptual: true,
    enableDebug: false,
    imageDecoder: async (buf) => {
      const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      return { data: new Uint8Array(data), width: info.width, height: info.height }
    },
    ...options,
  })
  await writeFile(new URL(file, OUT), ktx2)
  console.log(`  ${file}  ${(ktx2.byteLength / 1024).toFixed(0)} KB`)
}

function marble(size) {
  const px = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size
      const warp = fbm(u, v, 4, 6, 1)
      const vein = Math.pow(1 - Math.abs(Math.sin(Math.PI * (u * 2 + v) + warp * 7)), 18)
      const fine = Math.pow(1 - Math.abs(Math.sin(Math.PI * (u - v * 3) + fbm(u, v, 8, 5, 9) * 9)), 40)
      const cloud = fbm(u, v, 3, 4, 20)
      const grain = (hash(x, y, 77) - 0.5) * 0.012
      const l = 0.965 - vein * 0.11 - fine * 0.05 - (cloud - 0.5) * 0.03 + grain
      const i = (y * size + x) * 4
      px[i] = Math.round(255 * Math.min(1, l * 0.997))
      px[i + 1] = Math.round(255 * Math.min(1, l * 0.998))
      px[i + 2] = Math.round(255 * Math.min(1, l + vein * 0.02))
      px[i + 3] = 255
    }
  }
  return px
}

function cloud(size) {
  const px = Buffer.alloc(size * size * 4)
  const puffs = [
    [0.5, 0.56, 0.2], [0.34, 0.6, 0.15], [0.66, 0.6, 0.16], [0.42, 0.46, 0.14],
    [0.58, 0.44, 0.15], [0.22, 0.65, 0.1], [0.78, 0.65, 0.11], [0.5, 0.36, 0.11],
  ]
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size
      let d = 0
      for (const [cx, cy, r] of puffs) d += Math.exp(-((u - cx) ** 2 + (v - cy) ** 2) / (r * r))
      const erosion = fbm(u, v, 6, 5, 3)
      const flatBottom = 1 - Math.max(0, (v - 0.7) / 0.12)
      const den = Math.max(0, Math.min(1, (d * 0.9 - 0.25 + (erosion - 0.5) * 0.9) * 1.8)) * Math.max(0, flatBottom)
      const shade = 1 - Math.max(0, v - 0.45) * 0.28 - (1 - erosion) * 0.05
      const i = (y * size + x) * 4
      px[i] = Math.round(255 * shade * 0.97)
      px[i + 1] = Math.round(255 * shade * 0.985)
      px[i + 2] = Math.round(255 * Math.min(1, shade * 1.01))
      px[i + 3] = Math.round(255 * Math.pow(den, 1.35))
    }
  }
  return px
}

console.log('textures')
await toKTX2(marble(1024), 1024, 'textures/marble.ktx2', { isUASTC: false, qualityLevel: 230 })
await toKTX2(cloud(512), 512, 'textures/cloud.ktx2', { isUASTC: true, needSupercompression: true, isYFlip: true })

// Device: book-style foldable e-ink tablet. Closed it is a phone with a cover
// screen; open, one continuous e-paper display spans both halves.
console.log('models')
const doc = new Document()
const buffer = doc.createBuffer()
const scene = doc.createScene('Device')
const mat = (name, color, metallic, roughness) =>
  doc.createMaterial(name).setBaseColorFactor([...color, 1]).setMetallicFactor(metallic).setRoughnessFactor(roughness)
const ceramic = mat('Ceramic', [0.9, 0.895, 0.88], 0, 0.42)
const gold = mat('Gold', [0.83, 0.69, 0.47], 1, 0.26)
const screen = mat('Screen', [0.88, 0.88, 0.86], 0, 0.9)
const cover = mat('Cover', [0.88, 0.88, 0.86], 0, 0.9)

function mesh(name, g, material) {
  const prim = doc.createPrimitive().setMaterial(material)
  const attr = (key, type, a) =>
    prim.setAttribute(key, doc.createAccessor().setType(type).setArray(new Float32Array(a.array)).setBuffer(buffer))
  attr('POSITION', 'VEC3', g.attributes.position)
  attr('NORMAL', 'VEC3', g.attributes.normal)
  attr('TEXCOORD_0', 'VEC2', g.attributes.uv)
  if (g.index) prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(g.index.array)).setBuffer(buffer))
  return doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(prim))
}

const W = 0.72, H = 1.6, D = 0.052, GAP = 0.003, AXIS_Z = D / 2 + 0.0015
const BEZEL = 0.03
const SW = W + GAP - BEZEL, SH = H - 0.07 // each inner panel runs right up to the fold: one seamless sheet
const SHIFT = W / 2 + GAP - SW / 2 + 0.0012 // panels overlap a hair past the fold, so no seam can show
const half = () => new RoundedBoxGeometry(W, H, D, 6, 0.024)
const panel = (u0) => {
  const g = new PlaneGeometry(SW, SH)
  const uv = g.attributes.uv
  for (let i = 0; i < uv.count; i++) uv.setX(i, u0 + uv.getX(i) * 0.5)
  return g
}

// Mesh nodes stay leaves: quantization writes a dequantize scale onto them.
const root = doc.createNode('Device')
const left = doc.createNode('Left').setTranslation([-(W / 2 + GAP), 0, 0])
left.addChild(mesh('LeftBody', half(), ceramic))
left.addChild(mesh('ScreenLeft', panel(0), screen).setTranslation([SHIFT, 0, D / 2 + 0.0006]))
const hinge = doc.createNode('Hinge').setTranslation([0, 0, AXIS_Z])
const right = doc.createNode('Right').setTranslation([W / 2 + GAP, 0, -AXIS_Z])
right.addChild(mesh('RightBody', half(), ceramic))
right.addChild(mesh('ScreenRight', panel(0.5), screen).setTranslation([-SHIFT, 0, D / 2 + 0.0006]))
right.addChild(mesh('CoverScreen', new PlaneGeometry(W - 0.07, H - 0.12).rotateY(Math.PI), cover).setTranslation([0, 0, -D / 2 - 0.0006]))
right.addChild(mesh('Button', new RoundedBoxGeometry(0.014, 0.17, 0.022, 2, 0.006), gold).setTranslation([W / 2 + 0.004, 0.36, 0]))
hinge.addChild(right)
for (const y of [-1, 1]) root.addChild(mesh(`Cap${y > 0 ? 'Top' : 'Bottom'}`, new CylinderGeometry(0.022, 0.022, 0.05, 32), gold).setTranslation([0, y * (H / 2 - 0.035), AXIS_Z - 0.03]))
root.addChild(left).addChild(hinge)
scene.addChild(root)

await MeshoptEncoder.ready
// UVs have no texture yet (the screen image is drawn at runtime), so prune must keep them.
await doc.transform(prune({ keepAttributes: true }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }))
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder })
const glb = await io.writeBinary(doc)
await writeFile(new URL('models/eink-fold.glb', OUT), glb)
console.log(`  models/eink-fold.glb  ${(glb.byteLength / 1024).toFixed(0)} KB`)

// Favicon from the wordmark's "C" glyph
const logo = await readFile(new URL('brand/computarial-black.svg', OUT), 'utf8')
const glyph = logo.match(/<path d="[^"]+"/)[0]
await writeFile(
  new URL('favicon.svg', OUT),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-10 -6 104 104"><style>path{fill:#14161b}@media(prefers-color-scheme:dark){path{fill:#f4f6f8}}</style>${glyph}/></svg>\n`,
)
console.log('  favicon.svg')
