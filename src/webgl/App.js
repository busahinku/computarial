import {
  CatmullRomCurve3, DirectionalLight, Fog, HalfFloatType, HemisphereLight, MathUtils, PMREMGenerator,
  PerspectiveCamera, Plane, Raycaster, Scene, SRGBColorSpace, Vector2, Vector3, WebGLRenderer,
} from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import {
  BloomEffect, BrightnessContrastEffect, DepthOfFieldEffect, EffectComposer, EffectPass, NoiseEffect, RenderPass,
  ToneMappingEffect, ToneMappingMode, VignetteEffect, BlendFunction,
} from 'postprocessing'
import gsap from 'gsap'
import { state, env, bus } from '../core/store.js'
import { Sky, HORIZON } from './world/Sky.js'
import { Sanctuary } from './world/Sanctuary.js'
import { Feathers, BLOOM_CENTER, HALO_CENTER } from './world/Feathers.js'
import { Armillary } from './world/Armillary.js'
import { Atmosphere } from './world/Atmosphere.js'
import { Device } from './world/Device.js'

// One key per story chapter: camera position, look target, focus point.
const KEYS = [
  { pos: [0.3, 2.2, 7.5], look: [-1.3, 2.35, 0], focus: BLOOM_CENTER },
  { pos: [2.7, 1.65, 5.3], look: [0.1, 2.75, 0], focus: [0.6, 2.5, 2.2] },
  { pos: [0, 2.38, 7.3], look: [0, 2.35, 0], focus: BLOOM_CENTER },
  { pos: [-2.6, 2.75, 6.6], look: [1.15, 2.3, 0], focus: BLOOM_CENTER },
  { pos: [0, 1.9, 6.8], look: [0, 6.7, -2.6], focus: HALO_CENTER },
]
const INTRO = { pos: new Vector3(-1.2, 15.5, 4.2), look: new Vector3(0, 2, -0.5) }
const SUN_HERO = new Vector3(-0.52, 0.55, -0.66).normalize()
const SUN_HALO = new Vector3(0, 0.6, -0.8).normalize()

const v3 = (a) => (a.isVector3 ? a.clone() : new Vector3(...a))
const _pos = new Vector3()
const _look = new Vector3()
const _focus = new Vector3()
const _dir = new Vector3()
const _ndc = new Vector2()

export class App {
  constructor(canvas) {
    this.canvas = canvas
    this.pointer = new Vector2()
    this.pointerWorld = new Vector3().copy(BLOOM_CENTER)
    this.raycaster = new Raycaster()
    this.plane = new Plane()
    this.sunDir = SUN_HERO.clone()
    this.time = 0
    this.frames = []
    this.quality = 1 // governor multiplier on the resolution budget
    this.size = [0, 0]
  }

  init() {
    const high = (this.high = env.tier === 'high')
    this.dpr = this.#pixelRatio()

    this.renderer = new WebGLRenderer({ canvas: this.canvas, antialias: false, stencil: false, powerPreference: 'high-performance' })
    this.renderer.outputColorSpace = SRGBColorSpace
    this.renderer.setPixelRatio(this.dpr)

    this.scene = new Scene()
    this.scene.fog = new Fog(HORIZON, 26, 190)
    this.camera = new PerspectiveCamera(34, innerWidth / innerHeight, 0.1, 800)

    const pmrem = new PMREMGenerator(this.renderer)
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.035).texture
    this.scene.environmentIntensity = 0.62
    pmrem.dispose()

    this.scene.add(new HemisphereLight('#dfe8f4', '#efe8dd', 0.6))
    this.sun = new DirectionalLight('#fff1dc', 2.1)
    this.scene.add(this.sun)

    this.camPath = new CatmullRomCurve3(KEYS.map((k) => v3(k.pos)), false, 'centripetal')
    this.lookPath = new CatmullRomCurve3(KEYS.map((k) => v3(k.look)), false, 'centripetal')
    this.focusPath = new CatmullRomCurve3(KEYS.map((k) => v3(k.focus)), false, 'centripetal')

    // Post: DoF needs its own pass (convolution); bloom, grading and grain merge into one.
    // MSAA only where pixels are coarse; at 1.5x the extra samples cost more than they show.
    this.composer = new EffectComposer(this.renderer, { frameBufferType: HalfFloatType, multisampling: this.#samples() })
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    if (high) {
      this.dof = new DepthOfFieldEffect(this.camera, { focusDistance: 7, focusRange: 3.6, bokehScale: 2.2, resolutionScale: 0.38 })
      this.dof.target = new Vector3().copy(BLOOM_CENTER)
      this.dofPass = new EffectPass(this.camera, this.dof)
      this.composer.addPass(this.dofPass)
    }
    this.bloom = new BloomEffect({ intensity: 0.4, luminanceThreshold: 0.94, luminanceSmoothing: 0.25, mipmapBlur: true, radius: 0.7, levels: 6 })
    const noise = new NoiseEffect({ blendFunction: BlendFunction.SOFT_LIGHT, premultiply: false })
    noise.blendMode.opacity.value = 0.07
    this.composer.addPass(
      new EffectPass(
        this.camera,
        this.bloom,
        new ToneMappingEffect({ mode: ToneMappingMode.NEUTRAL }),
        new BrightnessContrastEffect({ brightness: 0, contrast: 0.07 }),
        new VignetteEffect({ offset: 0.3, darkness: 0.2 }),
        noise,
      ),
    )

    this.resize()
    // Coalesced: mobile URL bars and window drags fire resize dozens of times per second
    let pending = 0
    addEventListener('resize', () => {
      clearTimeout(pending)
      pending = setTimeout(() => this.resize(), 120)
    })

    // A lost GPU context (driver reset, too many tabs) shows the painted-sky fallback until restored
    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault()
      document.documentElement.classList.add('no-webgl')
      if (this.tick) gsap.ticker.remove(this.tick)
    })
    this.canvas.addEventListener('webglcontextrestored', () => {
      document.documentElement.classList.remove('no-webgl')
      if (this.tick) gsap.ticker.add(this.tick)
    })
    addEventListener('pointermove', (e) => {
      state.pointerX = (e.clientX / innerWidth) * 2 - 1
      state.pointerY = (e.clientY / innerHeight) * 2 - 1
    })
  }

  // Objects that need only the "core" asset stage
  buildCore(assets) {
    this.sky = new Sky({ cloud: assets.get('cloud'), sunDir: this.sunDir })
    this.sanctuary = new Sanctuary({ marble: assets.get('marble') })
    this.feathers = new Feathers({ tier: env.tier, sunDir: this.sunDir, pointer: this.pointerWorld })
    this.armillary = new Armillary()
    this.atmosphere = new Atmosphere({ tier: env.tier, sunDir: this.sunDir })
    this.scene.add(this.sky.group, this.sanctuary.group, ...this.feathers.meshes, this.armillary.group, this.armillary.core, this.atmosphere.group)
    this.resize(true)
    this.update(0, 0)
  }

  buildStory(assets) {
    this.device = new Device(assets.get('device'), { sunDir: this.sunDir })
    this.scene.add(this.device.group)
    bus.on('device:refresh', (on) => this.device.refresh(on))
  }

  prewarm(assets) {
    return assets.prewarm(this.renderer, this.scene, this.camera, () => this.composer.render(0))
  }

  // THE sync point. GSAP's ticker is the only requestAnimationFrame on the page:
  // per frame it advances Lenis (scroll), ScrollTrigger scrubs `state`, then this
  // callback reads `state` and renders. DOM and GPU never drift a frame apart.
  start() {
    this.tick = (time, deltaMs) => {
      const dt = Math.min(deltaMs / 1000, 1 / 20)
      this.time += dt * (env.reducedMotion ? 0.35 : 1)
      this.update(this.time, dt)
      this.composer.render(dt)
      this.govern(dt)
    }
    gsap.ticker.add(this.tick)
  }

  update(t, dt) {
    const s = state
    const u = MathUtils.clamp(s.camT / 4, 0, 1)
    this.camPath.getPoint(u, _pos)
    this.lookPath.getPoint(u, _look)
    this.focusPath.getPoint(u, _focus)

    // Portrait: subject centered and lifted into the top half, above the copy
    if (env.portrait) {
      _look.x *= 0.15
      _look.y -= 1.35 - s.halo * 1.05
      _pos.x *= 0.5
      _pos.z += 0.5
    }

    _pos.lerpVectors(INTRO.pos, _pos, s.intro)
    _look.lerpVectors(INTRO.look, _look, s.intro)

    const k = 1 - Math.exp(-2.5 * dt)
    const reach = env.reducedMotion || env.touch ? 0 : 1
    this.pointer.x += (s.pointerX * reach - this.pointer.x) * k
    this.pointer.y += (s.pointerY * reach - this.pointer.y) * k
    this.camera.position.set(_pos.x + this.pointer.x * 0.28, _pos.y - this.pointer.y * 0.16, _pos.z)
    this.camera.lookAt(_look)
    this.camera.rotateZ(s.chaos * Math.sin(t * 0.6) * 0.035)

    // Cursor in world space, on the plane through the focus point: feathers part around it
    this.camera.getWorldDirection(_dir)
    this.plane.setFromNormalAndCoplanarPoint(_dir.negate(), _focus)
    this.raycaster.setFromCamera(_ndc.set(s.pointerX, -s.pointerY), this.camera)
    this.raycaster.ray.intersectPlane(this.plane, this.pointerWorld)

    this.sunDir.lerpVectors(SUN_HERO, SUN_HALO, MathUtils.smoothstep(s.halo, 0, 1)).normalize()
    this.sun.position.copy(this.sunDir).multiplyScalar(20)
    this.sun.intensity = 2.1 + s.halo * 0.6
    this.bloom.intensity = 0.4 + s.halo * 0.35
    if (this.dof) this.dof.target.copy(_focus)

    this.sky.update(t, s)
    this.sanctuary.update(t, s)
    this.feathers.update(t, dt, s, this.camera.position)
    this.armillary.update(t, dt, s)
    this.atmosphere.update(t, dt, s)
    this.device?.update(t, dt, s)
  }

  // Resolution follows a pixel budget, not just devicePixelRatio: a phone, a 1080p
  // monitor and a 4K or 5K display all cost the GPU about the same per frame.
  #pixelRatio() {
    const [w, h] = [this.canvas.clientWidth || innerWidth, this.canvas.clientHeight || innerHeight]
    const budget = this.high ? 4.2e6 : 1.4e6
    const cap = this.high ? 1.5 : 1.25
    return Math.max(0.5, Math.min(devicePixelRatio, cap, Math.sqrt(budget / (w * h))) * this.quality)
  }

  // Extra samples only where pixels are coarse; at 1.25x and above they cost more than they show
  #samples() {
    return this.high && this.dpr < 1.25 ? 2 : 0
  }

  resize(force = false) {
    // The canvas is sized to the large viewport, so mobile URL bars never trigger a re-allocation
    const w = this.canvas.clientWidth || innerWidth
    const h = this.canvas.clientHeight || innerHeight
    if (!force && w === this.size[0] && h === this.size[1]) return
    this.size = [w, h]
    const aspect = w / h
    this.dpr = this.#pixelRatio()
    this.camera.aspect = aspect
    this.camera.fov = aspect < 1 ? Math.min(70, MathUtils.radToDeg(2 * Math.atan(Math.tan(MathUtils.degToRad(24)) / aspect))) : 34
    this.camera.updateProjectionMatrix()
    this.renderer.setPixelRatio(this.dpr)
    this.renderer.setSize(w, h, false)
    const samples = this.#samples()
    if (this.composer.multisampling !== samples) this.composer.multisampling = samples
    this.composer.setSize(w, h, false)
    if (this.atmosphere) this.atmosphere.uniforms.uPixel.value = this.dpr
  }

  // Quality governor. Frame intervals are judged against the display's own refresh
  // (60 or 120 Hz), so pacing stays even. Levers, in order: resolution, depth of
  // field, then a steady 60 fps cap on high refresh screens.
  govern(dt) {
    if (this.time < 2.5 || document.hidden) return
    const f = this.frames
    f.push(dt)
    if (f.length < 60) return
    f.sort((a, b) => a - b)
    const refresh = f[3]
    const avg = f.reduce((a, b) => a + b, 0) / f.length
    f.length = 0
    if (avg < refresh * 1.18) return
    if (this.quality > 0.62) {
      this.quality = Math.max(0.62, this.quality - 0.13)
      this.resize(true)
    } else if (this.dofPass?.enabled) {
      this.dofPass.enabled = false
    } else if (refresh < 0.012 && !this.capped) {
      this.capped = true
      gsap.ticker.fps(60)
    }
  }
}
