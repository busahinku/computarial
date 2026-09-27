import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { SplitText } from 'gsap/SplitText'
import { bus, env } from '../core/store.js'

gsap.registerPlugin(ScrollTrigger, SplitText)

const $ = (s, root = document) => root.querySelector(s)
const $$ = (s, root = document) => [...root.querySelectorAll(s)]

// Headings are split into lines only when they reveal, then restored to plain text,
// so later resizes reflow naturally instead of keeping stale line breaks.
function reveal(headings, fades) {
  if (headings.length) gsap.set(headings, { autoAlpha: 0 })
  if (fades.length) gsap.set(fades, { autoAlpha: 0, y: 26 })
  return () => {
    const splits = headings.map((el) => SplitText.create(el, { type: 'lines', mask: 'lines', linesClass: 'line' }))
    if (headings.length) gsap.set(headings, { autoAlpha: 1 })
    const tl = gsap.timeline({ onComplete: () => splits.forEach((split) => split.revert()) })
    splits.forEach((split) =>
      tl.from(split.lines, { yPercent: 118, rotate: 2.5, transformOrigin: '0% 100%', duration: 1.4, stagger: 0.1, ease: 'expo.out' }, 0),
    )
    if (fades.length) tl.to(fades, { autoAlpha: 1, y: 0, duration: 1.2, stagger: 0.08, ease: 'expo.out' }, 0.3)
    return tl
  }
}

// The DOM layer: accessible copy, overlays and controls. Never touches WebGL.
export class Interface {
  constructor({ scroll, sound }) {
    this.scroll = scroll
    this.sound = sound
    this.sections = $$('[data-stage]')
  }

  init() {
    if (this.ready) return
    this.ready = true
    const url = import.meta.env.VITE_FLOWTRACK_URL
    if (url) $$('[data-download]').forEach((a) => (a.href = url))

    document.documentElement.style.setProperty('--wordmark', `url(${import.meta.env.BASE_URL}brand/computarial-black.svg)`)
    this.#chapters()
    this.#manifesto()
    this.#card()
    this.#footer()
    this.#anchors()
    this.#magnetic()
    this.#controls()
    this.#form()
  }

  intro() {
    return gsap
      .timeline()
      .fromTo('.nav', { autoAlpha: 0, y: -16 }, { autoAlpha: 1, y: 0, duration: 1.2, ease: 'expo.out' }, 0.6)
      .add(() => this.sections[0].reveal(), 0.8)
      .fromTo('.chapters', { autoAlpha: 0, x: 12 }, { autoAlpha: 1, x: 0, duration: 1, ease: 'expo.out' }, 1.2)
  }

  #chapters() {
    const last = this.sections.length - 1
    this.sections.forEach((section, i) => {
      section.reveal = reveal($$('[data-split]', section), $$('[data-fade]', section))
      if (i > 0) ScrollTrigger.create({ trigger: section, start: 'top 62%', once: true, onEnter: section.reveal })
      if (i < last) {
        gsap.to($('.stage__inner', section), {
          autoAlpha: 0,
          y: -70,
          ease: 'none',
          scrollTrigger: { trigger: section, start: 'bottom 92%', end: 'bottom 40%', scrub: true },
        })
      }
    })

    const links = $$('.nav__link, .chapters__item')
    bus.on('chapter', (i) => {
      const id = this.sections[i].id
      links.forEach((a) => a.toggleAttribute('aria-current', a.hash === `#${id}`))
    })
    const rail = $('.chapters')
    bus.on('progress', (p) => rail.style.setProperty('--p', p.toFixed(4)))
  }

  #manifesto() {
    const el = $('[data-words]')
    const split = SplitText.create(el, { type: 'words', wordsClass: 'word' })
    gsap.fromTo(split.words, { opacity: 0.16 }, {
      opacity: 1,
      stagger: 0.12,
      ease: 'none',
      scrollTrigger: { trigger: el.closest('[data-stage]'), start: 'top 55%', end: 'top -55%', scrub: true },
    })
  }

  #card() {
    const card = $('[data-card]')
    const dial = $('.dial__value', card)
    const count = $('[data-minutes]', card)
    const shown = { m: 0 }
    const tl = gsap
      .timeline({ paused: true })
      .fromTo(dial, { strokeDashoffset: 100 }, { strokeDashoffset: 32, duration: 2, ease: 'expo.out' }, 0.2)
      .fromTo(shown, { m: 0 }, {
        m: Number(count.dataset.minutes),
        duration: 2,
        ease: 'expo.out',
        onUpdate: () => (count.textContent = `${Math.floor(shown.m / 60)}h ${String(Math.round(shown.m % 60)).padStart(2, '0')}m`),
      }, 0.2)
      .fromTo($$('.bars i', card), { scaleY: 0 }, { scaleY: 1, duration: 1.2, stagger: 0.05, ease: 'expo.out' }, 0.3)
    bus.on('chapter', (i) => i === 2 && tl.progress() === 0 && tl.play())
    bus.on('chapter', (i) => i < 2 && tl.pause(0))

    // Tilt toward the cursor with a moving glare, like a pane of glass in the light
    if (env.touch || env.reducedMotion) return
    gsap.set(card, { transformPerspective: 900 })
    const rx = gsap.quickTo(card, 'rotationX', { duration: 0.8, ease: 'power3.out' })
    const ry = gsap.quickTo(card, 'rotationY', { duration: 0.8, ease: 'power3.out' })
    card.addEventListener('pointermove', (e) => {
      const r = card.getBoundingClientRect()
      const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height
      rx((0.5 - y) * 10)
      ry((x - 0.5) * 12)
      card.style.setProperty('--gx', `${x * 100}%`)
      card.style.setProperty('--gy', `${y * 100}%`)
    })
    card.addEventListener('pointerleave', () => {
      rx(0)
      ry(0)
    })
  }

  #footer() {
    const play = reveal([$('.footer__statement')], $$('.footer__up, .footer__col'))
    ScrollTrigger.create({ trigger: '.footer', start: 'top 70%', once: true, onEnter: play })
    gsap.from('.footer__mark svg', {
      yPercent: 60,
      autoAlpha: 0,
      ease: 'none',
      scrollTrigger: { trigger: '.footer__mark', start: 'top bottom', end: 'bottom bottom', scrub: true },
    })
  }

  #anchors() {
    document.addEventListener('click', (e) => {
      const a = e.target.closest('a[href^="#"]')
      const target = a && a.hash.length > 1 && document.querySelector(a.hash)
      if (!target) return
      e.preventDefault()
      this.scroll.scrollTo(target)
      const focus = a.dataset.focus && document.querySelector(a.dataset.focus)
      if (focus) setTimeout(() => focus.focus({ preventScroll: true }), env.reducedMotion ? 0 : 2300)
    })
  }

  #magnetic() {
    if (env.touch || env.reducedMotion) return
    $$('[data-magnetic]').forEach((el) => {
      const x = gsap.quickTo(el, 'x', { duration: 0.7, ease: 'power3.out' })
      const y = gsap.quickTo(el, 'y', { duration: 0.7, ease: 'power3.out' })
      el.addEventListener('pointermove', (e) => {
        const r = el.getBoundingClientRect()
        x((e.clientX - r.left - r.width / 2) * 0.22)
        y((e.clientY - r.top - r.height / 2) * 0.32)
      })
      el.addEventListener('pointerleave', () => {
        x(0)
        y(0)
      })
    })
  }

  #controls() {
    const toggles = $$('[data-sound]')
    toggles.forEach((b) => b.addEventListener('click', () => (this.sound.waiting ? this.sound.resume() : this.sound.toggle())))
    bus.on('sound', ({ on, waiting }) =>
      toggles.forEach((b) => {
        b.setAttribute('aria-pressed', String(on))
        b.toggleAttribute('data-waiting', waiting)
        const label = waiting ? 'Tap for Sound' : on ? 'Sound On' : 'Sound Off'
        b.querySelector('.sound__label').textContent = label
        b.setAttribute('aria-label', waiting ? 'Enable sound' : on ? 'Turn sound off' : 'Turn sound on')
      }),
    )

    let last = 0
    $$('.btn, .nav__link, .link').forEach((el) =>
      el.addEventListener('pointerenter', () => {
        const now = performance.now()
        if (now - last > 90) bus.emit('ui:hover')
        last = now
      }),
    )
  }

  #form() {
    const form = $('[data-waitlist]')
    const input = $('input', form)
    const button = $('button', form)
    const status = $('[data-status]', form)
    const set = (state, message) => {
      form.dataset.state = state
      status.textContent = message
      button.disabled = state === 'loading'
      input.setAttribute('aria-invalid', String(state === 'error' && !input.validity.valid))
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault()
      if (!input.value.trim() || !input.checkValidity()) {
        set('error', 'Please enter a valid email address.')
        input.focus()
        return
      }
      const endpoint = import.meta.env.VITE_WAITLIST_ENDPOINT
      if (!endpoint) {
        set('error', 'Signups open soon. Please check back shortly.')
        return
      }
      set('loading', 'Adding you to the list…')
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ email: input.value.trim() }),
        })
        if (!res.ok) throw new Error(res.statusText)
        form.reset()
        set('success', 'You are on the list. We will write when there is news.')
        bus.emit('ui:success')
      } catch {
        set('error', 'Something went wrong. Please try again.')
      }
    })
  }
}
