import gsap from 'gsap'

export class Preloader {
  constructor(el) {
    this.el = el
    this.count = el.querySelector('[data-count]')
    this.shown = { v: 0 }
    this.target = 0
  }

  set(p, duration = 0.45) {
    this.target = Math.max(this.target, p)
    return gsap.to(this.shown, {
      v: this.target,
      duration,
      ease: 'power2.out',
      overwrite: true,
      onUpdate: () => {
        this.count.textContent = Math.round(this.shown.v * 100)
        this.el.style.setProperty('--p', this.shown.v.toFixed(4))
      },
    })
  }

  async finish() {
    await this.set(1, 0.35)
    this.el.setAttribute('aria-busy', 'false')
  }

  leave() {
    return gsap
      .timeline({ onComplete: () => this.el.remove() })
      .to(this.el.querySelector('.preloader__stack'), { autoAlpha: 0, y: -18, duration: 0.45, ease: 'power2.in' })
      .to(this.el, { clipPath: 'inset(0% 0% 100% 0%)', duration: 1.1, ease: 'expo.inOut' }, 0.15)
  }
}
