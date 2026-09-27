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
    $$('[data-download]').forEach((a) => {
      if (url) {
        a.href = url
        a.removeAttribute('data-interest')
        a.removeAttribute('data-focus')
        $('.btn__label', a).textContent = 'Download Flowtrack'
      }
    })

    // Absolute: a relative url() inside a custom property resolves against the stylesheet, not the page
    const mark = new URL(`${import.meta.env.BASE_URL}brand/computarial-black.svg`, location.href)
    document.documentElement.style.setProperty('--wordmark', `url("${mark.href}")`)
    this.#chapters()
    this.#menu()
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

  // Deep links (computarial.com/#mission): the page always boots at the top for the intro, then travels there
  follow(hash) {
    const target = hash.length > 1 && this.sections.find((s) => `#${s.id}` === hash)
    if (target && target !== this.sections[0]) this.scroll.scrollTo(target)
  }

  #chapters() {
    const last = this.sections.length - 1
    this.sections.forEach((section, i) => {
      section.reveal = reveal($$('[data-split]', section), $$('[data-fade]', section))
      if (i > 0) ScrollTrigger.create({ trigger: section, start: 'top 62%', once: true, onEnter: section.reveal })
      if (i < last) {
        // The hero starts to lift with the very first scroll (gently, so a nudge does not hide it);
        // the other chapters hold their copy, then hand over as the next one arrives.
        const hero = i === 0
        gsap.to($('.stage__inner', section), {
          autoAlpha: 0,
          y: -70,
          ease: hero ? 'power1.in' : 'none',
          scrollTrigger: { trigger: section, start: hero ? 'top top' : 'bottom 92%', end: 'bottom 40%', scrub: true },
        })
      }
    })

    // aria-current needs a value: an empty attribute reads as "false" to assistive technology
    const links = $$('.nav__link, .chapters__item, .menu__link')
    bus.on('chapter', (i) => {
      const hash = `#${this.sections[i].id}`
      links.forEach((a) => (a.hash === hash ? a.setAttribute('aria-current', 'location') : a.removeAttribute('aria-current')))
    })
    const meters = $$('.chapters, [data-menu-toggle]')
    bus.on('progress', (p) => meters.forEach((el) => el.style.setProperty('--p', p.toFixed(4))))
  }

  // Phones: the nav links collapse into a sheet of chapters. While it is open the page behind
  // is inert and does not scroll; Escape, the toggle or a tap outside the panel closes it.
  #menu() {
    const toggle = $('[data-menu-toggle]')
    const menu = $('[data-menu]')
    const panel = $('.menu__panel', menu)
    const items = $$('.menu__list li, .menu__foot', menu)
    const behind = $$('main, .footer, .chapters')
    let tl
    this.menuOpen = false

    const set = (open) => {
      if (open === this.menuOpen) return
      this.menuOpen = open
      toggle.setAttribute('aria-expanded', String(open))
      toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu')
      behind.forEach((el) => (el.inert = open))
      tl?.kill()
      if (open) {
        this.scroll.stop()
        menu.hidden = false
        // Opacity, not autoAlpha: the links must stay focusable while they fade in
        tl = gsap
          .timeline()
          .fromTo(menu, { opacity: 0 }, { opacity: 1, duration: 0.35, ease: 'power2.out' })
          .fromTo(panel, { y: -14, scale: 0.98 }, { y: 0, scale: 1, duration: 0.7, ease: 'expo.out' }, 0)
          .fromTo(items, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.6, stagger: 0.04, ease: 'expo.out' }, 0.08)
        const first = $('.menu__link[aria-current]', menu) ?? $('.menu__link', menu)
        first.focus({ preventScroll: true })
      } else {
        this.scroll.start()
        tl = gsap.to(menu, { opacity: 0, duration: 0.25, ease: 'power2.in', onComplete: () => (menu.hidden = true) })
      }
    }
    this.closeMenu = () => set(false)

    toggle.addEventListener('click', () => set(!this.menuOpen))
    menu.addEventListener('click', (e) => !panel.contains(e.target) && set(false))
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !this.menuOpen) return
      set(false)
      toggle.focus()
    })
    // Rotating to a layout without the toggle closes the sheet
    addEventListener('resize', () => this.menuOpen && !toggle.offsetWidth && set(false))
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
      this.closeMenu?.()
      if (a.dataset.interest) this.#chooseInterest(a.dataset.interest)
      const focus = a.dataset.focus && document.querySelector(a.dataset.focus)
      this.scroll.scrollTo(target, { onComplete: () => focus?.focus({ preventScroll: true }) })
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

    // Hover ticks are for a mouse; on touch, pointerenter fires on every tap
    let last = 0
    $$('.btn, .nav__link, .link').forEach((el) =>
      el.addEventListener('pointerenter', (e) => {
        if (e.pointerType !== 'mouse') return
        const now = performance.now()
        if (now - last > 90) bus.emit('ui:hover')
        last = now
      }),
    )
  }

  #form() {
    const form = $('[data-waitlist]')
    const input = $('input[type="email"]', form)
    const button = $('button', form)
    const status = $('[data-status]', form)
    $$('input[name="interest"]', form).forEach((radio) => radio.addEventListener('change', () => this.#chooseInterest(radio.value)))
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
          body: JSON.stringify({ email: input.value.trim(), interest: form.elements.interest.value }),
        })
        if (!res.ok) throw new Error(res.statusText)
        const product = form.elements.interest.value === 'flowtrack' ? 'Flowtrack' : 'the first phone'
        form.reset()
        this.#chooseInterest('phone')
        set('success', `You are on the ${product} list. We will write when there is news.`)
        bus.emit('ui:success')
      } catch {
        set('error', 'Something went wrong. Please try again.')
      }
    })
  }

  #chooseInterest(value) {
    const radio = $(`input[name="interest"][value="${value}"]`)
    if (!radio) return
    radio.checked = true
    $('[data-interest-label]').textContent = value === 'flowtrack' ? 'Flowtrack' : 'first phone'
  }
}
