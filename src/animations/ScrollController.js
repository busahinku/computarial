import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import Lenis from 'lenis'
import { state, bus, env } from '../core/store.js'

gsap.registerPlugin(ScrollTrigger)

// Scene values each chapter settles on. Every tween below is from/to with explicit
// values, so the timeline can be rebuilt at any scroll position without drifting.
const CHAPTERS = [
  { camT: 0, formation: 0, chaos: 0, flow: 0, focus: 0, device: 0, halo: 0 },
  { camT: 1, formation: 1, chaos: 1, flow: 0, focus: 0, device: 0, halo: 0 },
  { camT: 2, formation: 2, chaos: 0, flow: 1, focus: 0, device: 0, halo: 0 },
  { camT: 3, formation: 3, chaos: 0, flow: 0, focus: 0, device: 1, halo: 0 },
  { camT: 4, formation: 4, chaos: 0, flow: 0, focus: 0, device: 0, halo: 1 },
]
const FOCUSED = 2 // chapter whose hold fills the focus arc

export class ScrollController {
  constructor() {
    this.story = document.querySelector('#story')
    this.sections = [...this.story.querySelectorAll('[data-stage]')]
  }

  init() {
    if (this.lenis) return
    // Lenis smooths the native scroll position. It runs on GSAP's ticker, which must be
    // registered before App.start() so each frame goes: scroll -> ScrollTrigger -> state -> render.
    this.lenis = new Lenis({ lerp: 0.085, wheelMultiplier: 0.9, smoothWheel: !env.reducedMotion, autoRaf: false })
    this.lenis.on('scroll', ScrollTrigger.update)
    gsap.ticker.add((time) => this.lenis.raf(time * 1000))
    gsap.ticker.lagSmoothing(0)
    this.lenis.stop()
    ScrollTrigger.clearScrollMemory('manual')
    this.lenis.scrollTo(0, { immediate: true, force: true })

    this.build()
    // Rotating a phone or resizing a window changes every section offset: rebuild the map
    let width = innerWidth
    ScrollTrigger.addEventListener('refresh', () => {
      if (innerWidth === width) return
      width = innerWidth
      this.build()
      ScrollTrigger.refresh()
    })
    this.sections.forEach((el, i) =>
      ScrollTrigger.create({
        trigger: el,
        start: 'top 50%',
        end: i === this.sections.length - 1 ? () => `+=${document.documentElement.scrollHeight}` : 'bottom 50%',
        onToggle: (self) => self.isActive && bus.emit('chapter', i),
      }),
    )
  }

  // One master timeline spans the whole story. Positions are derived from real section
  // offsets, so a chapter transition plays exactly while its section scrolls into view.
  build() {
    this.triggers?.forEach((t) => {
      t.animation?.kill()
      t.kill()
    })
    const vh = innerHeight
    const total = this.story.offsetHeight - vh
    const at = (px) => px / total
    const tl = gsap.timeline({ paused: true, defaults: { ease: 'sine.inOut', immediateRender: false } })

    this.sections.forEach((el, i) => {
      if (!i) return
      const from = { ...CHAPTERS[i - 1], focus: i - 1 === FOCUSED ? 1 : 0 }
      tl.fromTo(state, from, { ...CHAPTERS[i], duration: at(vh) }, at(el.offsetTop - vh))
    })
    const [, , flow, device] = this.sections
    tl.fromTo(state, { focus: 0 }, { focus: 1, duration: at(vh * 0.9), ease: 'power2.out' }, at(flow.offsetTop))
    tl.fromTo(state, { fold: 0 }, { fold: 1, duration: at(vh * 0.65), ease: 'power2.inOut' }, at(device.offsetTop - vh * 0.1))
    tl.set({}, {}, 1)

    const main = ScrollTrigger.create({
      trigger: this.story,
      start: 'top top',
      end: 'bottom bottom',
      scrub: true,
      animation: tl,
      onUpdate: (self) => bus.emit('progress', self.progress),
    })
    const refresh = ScrollTrigger.create({
      trigger: device,
      start: `top+=${Math.round(vh * 0.6)} top`,
      onEnter: () => bus.emit('device:refresh', true),
      onLeaveBack: () => bus.emit('device:refresh', false),
    })
    this.triggers = [main, refresh]
  }

  start() {
    this.lenis.start()
  }

  scrollTo(target) {
    this.lenis.scrollTo(target, { duration: 2.4, easing: (t) => 1 - Math.pow(1 - t, 4), immediate: env.reducedMotion })
  }
}
