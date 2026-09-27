import { CanvasTexture, Group, MathUtils, MeshPhysicalMaterial, SRGBColorSpace, ShaderMaterial } from 'three'
import gsap from 'gsap'
import { BLOOM_CENTER } from './Feathers.js'

const PAPER = '#dcdbd5'
const INK = '#1e1f22'
const DISPLAY = '"Newsreader Variable", Georgia, serif'
const UI = '"Geist Variable", system-ui, sans-serif'

// Physical sizes from the GLB (scripts/build-assets.mjs)
const W = 0.72
const INNER = [0.693, 1.53] // one inner panel
const COVER = [0.65, 1.48]

// One small tile of paper grain, repeated: per-pixel noise on full sheets would stall the main thread
let grain
function paperGrain() {
  if (grain) return grain
  grain = document.createElement('canvas')
  grain.width = grain.height = 256
  const ctx = grain.getContext('2d')
  const img = ctx.createImageData(256, 256)
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() * 255
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v
    img.data[i + 3] = 10
  }
  ctx.putImageData(img, 0, 0)
  return grain
}

function sheet(w, h, draw) {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = PAPER
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = ctx.createPattern(paperGrain(), 'repeat')
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = INK
  ctx.strokeStyle = INK
  draw(ctx, w, h)
  const tex = new CanvasTexture(canvas)
  tex.colorSpace = SRGBColorSpace
  tex.anisotropy = 8
  return tex
}

function wrap(ctx, text, x, y, width, lead) {
  let line = ''
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word
    if (ctx.measureText(next).width > width && line) {
      ctx.fillText(line, x, y)
      y += lead
      line = word
    } else line = next
  }
  ctx.fillText(line, x, y)
  return y
}

const soft = (ctx, a, fn) => {
  ctx.globalAlpha = a
  fn()
  ctx.globalAlpha = 1
}

// Cover: the phone face you see while folded
const coverFace = () =>
  sheet(700, 1594, (ctx, w) => {
    ctx.textAlign = 'center'
    ctx.font = `300 250px ${DISPLAY}`
    ctx.fillText('7:45', w / 2, 560)
    soft(ctx, 0.7, () => {
      ctx.font = `400 42px ${UI}`
      ctx.fillText('Tuesday, March 3', w / 2, 650)
    })
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.roundRect(70, 900, w - 140, 170, 36)
    ctx.stroke()
    ctx.textAlign = 'left'
    ctx.font = `500 36px ${UI}`
    ctx.fillText('Mom', 116, 970)
    soft(ctx, 0.72, () => {
      ctx.font = `400 34px ${UI}`
      ctx.fillText('See you at pickup!', 116, 1025)
    })
    ctx.textAlign = 'center'
    ctx.font = `italic 300 52px ${DISPLAY}`
    ctx.fillText('Open to begin', w / 2, 1400)
  })

// Inner display while asleep: blank paper with the wordmark
const innerSleep = () =>
  sheet(1600, 1766, (ctx, w, h) => {
    ctx.textAlign = 'center'
    soft(ctx, 0.5, () => {
      ctx.font = `300 64px ${DISPLAY}`
      ctx.fillText('Computarial', w / 2, h / 2)
    })
  })

// Inner display awake: the day on the left page, a book on the right
const innerHome = () =>
  sheet(1600, 1766, (ctx, w, h) => {
    const L = 70, R = w / 2 + 70, colW = w / 2 - 140
    soft(ctx, 0.75, () => {
      ctx.font = `500 30px ${UI}`
      ctx.fillText('7:46', L, 80)
      ctx.lineWidth = 2.5
      ctx.strokeRect(w - 128, 56, 50, 26)
      ctx.fillRect(w - 123, 61, 32, 16)
    })

    ctx.font = `300 96px ${DISPLAY}`
    ctx.fillText('Good morning,', L, 280)
    ctx.font = `italic 300 96px ${DISPLAY}`
    ctx.fillText('Mira.', L, 385)

    soft(ctx, 0.62, () => {
      ctx.font = `500 30px ${UI}`
      ctx.fillText('Today', L, 520)
    })
    const plan = [['8:30', 'School'], ['12:15', 'Lunch with Ava'], ['15:30', 'Piano lesson'], ['19:00', 'Reading time']]
    plan.forEach(([time, what], i) => {
      const y = 610 + i * 118
      soft(ctx, 0.62, () => {
        ctx.font = `400 34px ${UI}`
        ctx.fillText(time, L, y)
      })
      ctx.font = `500 40px ${UI}`
      ctx.fillText(what, L + 130, y)
      soft(ctx, 0.2, () => ctx.fillRect(L, y + 46, colW, 2))
    })

    ctx.lineWidth = 3
    ;['Call Mom', 'Message Dad'].forEach((label, i) => {
      const x = L + i * (colW / 2 + 10)
      ctx.beginPath()
      ctx.roundRect(x, h - 220, colW / 2 - 10, 96, 48)
      ctx.stroke()
      ctx.font = `500 34px ${UI}`
      ctx.textAlign = 'center'
      ctx.fillText(label, x + (colW / 2 - 10) / 2, h - 160)
      ctx.textAlign = 'left'
    })

    soft(ctx, 0.62, () => {
      ctx.font = `500 30px ${UI}`
      ctx.fillText('Chapter 4', R, 180)
    })
    ctx.font = `italic 300 76px ${DISPLAY}`
    ctx.fillText('The Lighthouse', R, 290)
    ctx.font = `300 150px ${DISPLAY}`
    ctx.fillText('E', R - 6, 470)
    ctx.font = `400 38px ${DISPLAY}`
    const lead = 'very evening the keeper climbed'
    const body =
      'the ninety steps and lit the lamp. He never counted the ships that passed. He only made sure each one could see the rocks in time. Mira read the line twice, then closed her eyes and pictured the light turning slowly over the water, patient and bright, asking nothing back.'
    wrap(ctx, lead, R + 104, 392, colW - 110, 58)
    wrap(ctx, body, R, 510, colW, 58)
    soft(ctx, 0.55, () => {
      ctx.font = `400 30px ${UI}`
      ctx.textAlign = 'center'
      ctx.fillText('42', R + colW / 2, h - 90)
    })
  })

const vertexShader = /* glsl */ `
  varying vec2 vUv; varying vec2 vLocal; varying vec3 vN;
  void main() {
    vUv = uv;
    vLocal = (vec2((uv.x - U0) * SPAN_U, uv.y) - 0.5) * SIZE;
    vN = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`

const fragmentShader = /* glsl */ `
  uniform sampler2D uA, uB; uniform float uRefresh; uniform vec3 uSunDir;
  varying vec2 vUv; varying vec2 vLocal; varying vec3 vN;
  float box(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
  void main() {
    // Outer corners round; the edge at the fold stays square so the display reads as one sheet.
    vec2 b = SIZE * 0.5;
    float d = box(vLocal - vec2(SIDE * 0.05, 0.0), b + vec2(abs(SIDE) * 0.05, 0.0), 0.028);
    if (d > 0.0) discard;
    vec3 a = texture2D(uA, vUv).rgb, n = texture2D(uB, vUv).rgb;
    vec3 ink = vec3(0.012), paper = vec3(0.71, 0.705, 0.68);
    float r = uRefresh;
    // Full e-ink refresh: invert, flash black, flash white, settle with a faint ghost.
    vec3 col = mix(a, paper + ink - a, smoothstep(0.0, 0.1, r));
    col = mix(col, ink, smoothstep(0.1, 0.22, r));
    col = mix(col, paper, smoothstep(0.22, 0.38, r));
    col = mix(col, n + (a - paper) * 0.08, smoothstep(0.4, 0.58, r));
    col = mix(col, n, smoothstep(0.6, 1.0, r));
    float light = 0.86 + 0.18 * max(dot(normalize(vN), normalize(uSunDir)), 0.0);
    col *= light * (0.92 + 0.08 * smoothstep(0.0, -0.015, d));
    gl_FragColor = vec4(col, 1.0);
  }`

// Book-style foldable e-ink tablet. Geometry comes from the GLB; materials and
// the e-paper shader live here so the look stays in code.
export class Device {
  constructor(gltf, { sunDir }) {
    this.group = new Group()
    this.root = gltf.scene.getObjectByName('Device')
    this.hinge = this.root.getObjectByName('Hinge')
    this.group.add(this.root)
    this.group.position.copy(BLOOM_CENTER)
    this.group.scale.setScalar(0.0001)
    this.group.visible = false

    this.inner = { uA: { value: innerSleep() }, uB: { value: innerHome() }, uRefresh: { value: 0 }, uSunDir: { value: sunDir } }
    const face = coverFace()
    const coverUniforms = { uA: { value: face }, uB: { value: face }, uRefresh: { value: 0 }, uSunDir: { value: sunDir } }
    const screen = (uniforms, defines) => new ShaderMaterial({ uniforms, defines, vertexShader, fragmentShader })
    const glsl = (v) => `vec2(${v[0]}, ${v[1]})`
    const materials = {
      ScreenLeft: screen(this.inner, { U0: '0.0', SPAN_U: '2.0', SIZE: glsl(INNER), SIDE: '1.0' }),
      ScreenRight: screen(this.inner, { U0: '0.5', SPAN_U: '2.0', SIZE: glsl(INNER), SIDE: '-1.0' }),
      CoverScreen: screen(coverUniforms, { U0: '0.0', SPAN_U: '1.0', SIZE: glsl(COVER), SIDE: '0.0' }),
    }
    const ceramic = new MeshPhysicalMaterial({
      color: '#f3f1ec', roughness: 0.34, clearcoat: 0.6, clearcoatRoughness: 0.2, sheen: 0.35, sheenColor: '#ffffff', envMapIntensity: 1.1,
    })
    const gold = new MeshPhysicalMaterial({ color: '#e6c992', metalness: 1, roughness: 0.2, envMapIntensity: 1.5 })
    this.root.traverse((o) => {
      if (!o.isMesh) return
      o.material = materials[o.name] ?? (o.material.name === 'Gold' ? gold : ceramic)
    })
  }

  refresh(on) {
    gsap.to(this.inner.uRefresh, { value: on ? 1 : 0, duration: on ? 1.2 : 0.35, ease: on ? 'none' : 'power2.out', overwrite: true })
  }

  update(t, dt, s) {
    const presence = MathUtils.smoothstep(s.device, 0, 1)
    this.group.visible = presence > 0.001
    if (!this.group.visible) return

    const open = MathUtils.smoothstep(s.fold, 0, 1)
    const shut = 1 - open
    this.hinge.rotation.y = -shut * Math.PI * 0.985
    // Keep the visual center on the pedestal axis while the right half swings
    this.root.position.set(shut * W * 0.5, 0, -shut * 0.03)
    this.group.scale.setScalar(1.3 * (0.4 + 0.6 * presence))
    this.group.position.set(BLOOM_CENTER.x, BLOOM_CENTER.y + Math.sin(t * 0.8) * 0.04 + (1 - presence) * 1.4, BLOOM_CENTER.z)
    this.group.rotation.set(
      -0.05 + Math.sin(t * 0.5) * 0.015,
      -0.3 + shut * 0.55 + Math.sin(t * 0.3) * 0.04 - (1 - presence) * 2.2,
      shut * 0.04,
    )
  }
}
