// Single source of truth between DOM scroll and the WebGL scene.
// GSAP writes these numbers (scrubbed by ScrollTrigger); App reads them every frame.
// Nothing else talks across that boundary, so the render loop never touches the DOM.
export const state = {
  intro: 0, // 0 -> 1 camera descent after the preloader
  camT: 0, // camera spline position, 0..4 (one unit per story stage)
  formation: 0, // hero feathers: 0 bloom, 1 scatter, 2 stream, 3 orbit, 4 halo
  chaos: 0, // turbulence of the "noise" chapter
  flow: 0, // drift feathers join laminar lanes
  focus: 0, // Flowtrack focus arc fill
  device: 0, // device presence
  fold: 0, // 0 closed, 1 open
  halo: 0, // finale light
  pointerX: 0,
  pointerY: 0,
}

export class Emitter {
  #map = new Map()

  on(type, fn) {
    if (!this.#map.has(type)) this.#map.set(type, new Set())
    this.#map.get(type).add(fn)
    return () => this.#map.get(type).delete(fn)
  }

  emit(type, payload) {
    this.#map.get(type)?.forEach((fn) => fn(payload))
  }
}

export const bus = new Emitter()

export const env = {
  reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
  touch: matchMedia('(pointer: coarse)').matches,
  get portrait() {
    return innerWidth / innerHeight < 0.9
  },
}
env.tier = env.touch || Math.min(screen.width, screen.height) < 700 ? 'low' : 'high'
