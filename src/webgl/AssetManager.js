import { RepeatWrapping, SRGBColorSpace } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { Howl } from 'howler'
import { Emitter } from '../core/store.js'

const BASE = import.meta.env.BASE_URL

// Stage "core" blocks the preloader: everything the first frame needs.
// Stage "story" streams in behind the hero and is pre-warmed before the user scrolls to it.
export const manifest = {
  core: [
    { key: 'marble', type: 'ktx2', url: 'textures/marble.ktx2', repeat: true },
    { key: 'cloud', type: 'ktx2', url: 'textures/cloud.ktx2' },
    {
      key: 'fonts',
      type: 'fonts',
      faces: ['300 64px "Newsreader Variable"', 'italic 300 64px "Newsreader Variable"', '400 16px "Geist Variable"', '500 16px "Geist Variable"'],
    },
  ],
  story: [
    { key: 'device', type: 'glb', url: 'models/eink-fold.glb' },
    { key: 'ambient', type: 'audio', url: 'audio/ambient', loop: true },
    { key: 'chime', type: 'audio', url: 'audio/chime' },
    { key: 'whoosh', type: 'audio', url: 'audio/whoosh' },
    { key: 'tick', type: 'audio', url: 'audio/tick' },
  ],
}

export class AssetManager extends Emitter {
  #items = new Map()

  constructor(renderer) {
    super()
    this.ktx2 = new KTX2Loader().detectSupport(renderer)
    this.gltf = new GLTFLoader().setKTX2Loader(this.ktx2).setMeshoptDecoder(MeshoptDecoder)
  }

  get(key) {
    return this.#items.get(key)
  }

  async loadStage(stage) {
    const list = manifest[stage]
    const done = new Array(list.length).fill(0)
    const report = () => this.emit('progress', { stage, value: done.reduce((a, b) => a + b, 0) / list.length })

    await Promise.all(
      list.map(async (item, i) => {
        const onProgress = (e) => {
          if (!e.lengthComputable) return
          done[i] = (e.loaded / e.total) * 0.9
          report()
        }
        this.#items.set(item.key, await this.#load(item, onProgress))
        done[i] = 1
        report()
      }),
    )
    this.emit('stage', stage)
  }

  #load(item, onProgress) {
    const url = BASE + item.url
    switch (item.type) {
      case 'ktx2':
        return this.ktx2.loadAsync(url, onProgress).then((tex) => {
          tex.colorSpace = SRGBColorSpace
          tex.anisotropy = 8
          if (item.repeat) tex.wrapS = tex.wrapT = RepeatWrapping
          return tex
        })
      case 'glb':
        return this.gltf.loadAsync(url, onProgress)
      case 'fonts':
        return Promise.all(item.faces.map((f) => document.fonts.load(f)))
      case 'audio':
        return new Promise((resolve) => {
          const howl = new Howl({
            src: [`${url}.webm`, `${url}.mp3`],
            loop: !!item.loop,
            volume: 0,
            onload: () => resolve(howl),
            onloaderror: () => resolve(null), // sound is optional, never block the experience
          })
        })
    }
  }

  // GPU pre-warm. Shader programs, textures and vertex buffers are uploaded
  // before the frame that needs them, so no chapter ever hitches on first view.
  async prewarm(renderer, scene, camera, render) {
    const restore = []
    scene.traverse((o) => {
      restore.push([o, o.visible, o.frustumCulled])
      o.visible = true
      o.frustumCulled = false
    })

    await renderer.compileAsync(scene, camera)

    scene.traverse((o) => {
      for (const m of [].concat(o.material ?? [])) {
        for (const v of Object.values(m)) if (v?.isTexture) renderer.initTexture(v)
        for (const u of Object.values(m.uniforms ?? {})) if (u.value?.isTexture) renderer.initTexture(u.value)
      }
    })

    render()
    for (const [o, visible, culled] of restore) {
      o.visible = visible
      o.frustumCulled = culled
    }
  }
}
