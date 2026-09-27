import { Howler } from 'howler'
import { bus } from '../core/store.js'

const AMBIENT_VOLUME = 0.38

// Howler-backed soundscape. It starts on its own; browsers hold audio until the
// first click or key press, and Howler resumes it the moment that happens.
export class Sound {
  constructor() {
    this.enabled = false
    this.howls = {}
    bus.on('chapter', (i) => i > 0 && this.play('whoosh', 0.28))
    bus.on('device:refresh', (on) => on && this.play('chime', 0.4))
    bus.on('ui:hover', () => this.play('tick', 0.12))
    bus.on('ui:success', () => this.play('chime', 0.5))
  }

  attach(assets) {
    for (const key of ['ambient', 'chime', 'whoosh', 'tick']) this.howls[key] = assets.get(key)
    Howler.ctx?.addEventListener('statechange', () => this.#report())
    if (this.enabled) this.#ambient(true)
    this.#report()
  }

  toggle(on = !this.enabled) {
    this.enabled = on
    this.#ambient(on)
    this.#report()
    return on
  }

  get waiting() {
    return this.enabled && !!Howler.ctx && Howler.ctx.state !== 'running'
  }

  resume() {
    Howler.ctx?.resume()
  }

  play(key, volume) {
    const h = this.howls[key]
    if (!this.enabled || !h || Howler.ctx?.state !== 'running') return
    h.volume(volume)
    h.play()
  }

  // "waiting" = on, but the browser has not unlocked audio yet
  #report() {
    bus.emit('sound', { on: this.enabled, waiting: this.waiting })
  }

  #ambient(on) {
    const h = this.howls.ambient
    if (!h) return
    if (on) {
      if (!h.playing()) h.play()
      h.fade(h.volume(), AMBIENT_VOLUME, 2400)
    } else {
      h.fade(h.volume(), 0, 900)
      h.once('fade', () => !this.enabled && h.pause())
    }
  }
}
