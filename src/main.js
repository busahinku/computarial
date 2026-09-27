import '@fontsource-variable/newsreader/opsz.css'
import '@fontsource-variable/newsreader/opsz-italic.css'
import '@fontsource-variable/geist'
import 'lenis/dist/lenis.css'
import './styles/main.css'
import gsap from 'gsap'
import { state, env } from './core/store.js'
import { App } from './webgl/App.js'
import { AssetManager } from './webgl/AssetManager.js'
import { ScrollController } from './animations/ScrollController.js'
import { Preloader } from './ui/Preloader.js'
import { Interface } from './ui/Interface.js'
import { Sound } from './audio/Sound.js'

history.scrollRestoration = 'manual'
scrollTo(0, 0)

const root = document.documentElement
const scroll = new ScrollController()
const sound = new Sound()
const ui = new Interface({ scroll, sound })

async function boot() {
  const preloader = new Preloader(document.querySelector('.preloader'))
  const app = new App(document.querySelector('.webgl'))
  app.init()

  const assets = new AssetManager(app.renderer)
  assets.on('progress', ({ stage, value }) => stage === 'core' && preloader.set(value * 0.85))
  await assets.loadStage('core')
  app.buildCore(assets)
  await app.prewarm(assets)

  // Order matters: Lenis joins the GSAP ticker before the render callback.
  scroll.init()
  ui.init()
  app.start()

  // Story assets download now; building and GPU upload wait for the intro flight to finish,
  // then run when the main thread is idle, so the opening never drops a frame.
  let introDone
  const intro = new Promise((resolve) => (introDone = resolve))
  const idle = () => new Promise((resolve) => (window.requestIdleCallback ?? setTimeout)(resolve, { timeout: 800 }))
  assets.loadStage('story').then(async () => {
    sound.attach(assets)
    await intro
    await idle()
    app.buildStory(assets)
    await app.prewarm(assets)
  })

  if (import.meta.env.DEV) Object.assign(window, { __scroll: scroll, __state: state, __app: app })
  await preloader.finish()
  sound.toggle(true)
  root.classList.remove('is-loading')
  preloader.leave()
  ui.intro()
  gsap.to(state, { intro: 1, duration: env.reducedMotion ? 0.01 : 3.2, ease: 'power3.inOut', onComplete: introDone })
  gsap.delayedCall(env.reducedMotion ? 0 : 1.2, () => scroll.start())
}

// Without WebGL2 the page is still the full story: DOM copy over a painted sky.
function fallback() {
  root.classList.add('no-webgl')
  root.classList.remove('is-loading')
  document.querySelector('.preloader')?.remove()
  state.intro = 1
  scroll.init()
  ui.init()
  scroll.start()
  ui.intro()
}

if (document.createElement('canvas').getContext('webgl2')) {
  boot().catch((err) => {
    console.error(err)
    fallback()
  })
} else {
  fallback()
}
