import {
  BufferGeometry, Color, Float32BufferAttribute, FrontSide, Group, InstancedMesh, Mesh, Object3D, Points,
  ShaderMaterial, SphereGeometry,
} from 'three'
import { mulberry, SPOW } from './Sky.js'
import { gold } from './Sanctuary.js'
import { pearl } from './Armillary.js'

const dummy = new Object3D()

// Floating pearls, gold beads, soap-film bubbles and light motes.
export class Atmosphere {
  constructor({ tier, sunDir }) {
    this.group = new Group()
    const rnd = mulberry(23)
    // Orbs keep clear of everything solid: the fan, the device, the rings and the sky halo
    const clear = (x, y, z) => Math.hypot(x, y - 2.4, z) > 3 && Math.hypot(x, y - 8.3, z + 3.2) > 4.6
    const scatter = (n, rMin, rMax, yMin, yMax, sMin, sMax) =>
      Array.from({ length: n }, () => {
        let a, r, y
        do {
          a = rnd() * Math.PI * 2
          r = rMin + rnd() * (rMax - rMin)
          y = yMin + rnd() * (yMax - yMin)
        } while (!clear(Math.cos(a) * r, y, Math.sin(a) * r))
        return { x: Math.cos(a) * r, y, z: Math.sin(a) * r, s: sMin + rnd() * (sMax - sMin), ph: rnd() * 10 }
      })

    const sphere = new SphereGeometry(1, 32, 16)
    this.beads = [
      [new InstancedMesh(sphere, pearl, 26), scatter(26, 2.2, 6.6, 0.9, 6, 0.035, 0.1)],
      [new InstancedMesh(sphere, gold, 16), scatter(16, 2.2, 6.6, 0.6, 5.5, 0.018, 0.045)],
    ]
    for (const [mesh] of this.beads) {
      mesh.frustumCulled = false
      this.group.add(mesh)
    }

    this.uniforms = { uTime: { value: 0 }, uSunDir: { value: sunDir }, uPixel: { value: 1 } }
    const bubbleMat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: FrontSide,
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `${SPOW}
        varying vec3 vN; varying vec3 vWorld; varying vec3 vLocal;
        void main() {
          vLocal = position;
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWorld = w.xyz;
          vN = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `${SPOW}
        uniform float uTime; uniform vec3 uSunDir;
        varying vec3 vN; varying vec3 vWorld; varying vec3 vLocal;
        void main() {
          vec3 N = normalize(vN), V = normalize(cameraPosition - vWorld);
          float F = spow(1.0 - max(dot(N, V), 0.0), 2.2);
          float film = vLocal.y * 1.6 + sin(vLocal.x * 5.0 + uTime * 0.6) * 0.25 + sin(vLocal.z * 4.0 - uTime * 0.4) * 0.2;
          vec3 col = 0.55 + 0.45 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + film + F * 0.8));
          float spec = spow(max(dot(reflect(-normalize(uSunDir), N), V), 0.0), 180.0);
          gl_FragColor = vec4(col * 1.05 + spec * 3.0, F * 0.5 + 0.015 + spec);
        }`,
    })
    this.bubbles = scatter(7, 3.2, 6.4, 1.2, 5.6, 0.16, 0.38).map((b) => {
      const m = new Mesh(new SphereGeometry(1, 48, 24), bubbleMat)
      m.userData = b
      m.renderOrder = 2
      this.group.add(m)
      return m
    })

    const count = tier === 'high' ? 420 : 160
    const pos = [], seed = []
    for (let i = 0; i < count; i++) {
      const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 8.2
      pos.push(Math.cos(a) * r, rnd() * 10, Math.sin(a) * r)
      seed.push(rnd())
    }
    const geo = new BufferGeometry()
    geo.setAttribute('position', new Float32BufferAttribute(pos, 3))
    geo.setAttribute('aSeed', new Float32BufferAttribute(seed, 1))
    this.motes = new Points(
      geo,
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: { ...this.uniforms, uColor: { value: new Color('#f6d9a4').multiplyScalar(1.5) } },
        vertexShader: /* glsl */ `${SPOW}
          attribute float aSeed;
          uniform float uTime, uPixel;
          varying float vAlpha;
          void main() {
            vec3 p = position;
            p.y = mod(p.y + uTime * 0.06 * (0.4 + aSeed), 10.0) - 0.3;
            p.x += sin(uTime * 0.3 + aSeed * 30.0) * 0.25;
            p.z += cos(uTime * 0.25 + aSeed * 20.0) * 0.25;
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            gl_PointSize = (1.2 + aSeed * 3.2) * uPixel * (7.0 / -mv.z);
            vAlpha = (0.35 + 0.65 * (0.5 + 0.5 * sin(uTime * (0.8 + aSeed * 2.5) + aSeed * 60.0))) * smoothstep(-0.3, 1.0, p.y);
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `${SPOW}
          uniform vec3 uColor; varying float vAlpha;
          void main() {
            float d = length(gl_PointCoord - 0.5);
            float a = smoothstep(0.5, 0.0, d);
            gl_FragColor = vec4(uColor, a * a * vAlpha);
          }`,
      }),
    )
    this.motes.frustumCulled = false
    this.group.add(this.motes)
  }

  update(t, dt, s) {
    this.uniforms.uTime.value = t
    const lift = 1 + s.chaos * 1.8
    for (const [mesh, data] of this.beads) {
      data.forEach((b, i) => {
        dummy.position.set(b.x + Math.sin(t * 0.3 * lift + b.ph) * 0.15, b.y + Math.sin(t * 0.55 + b.ph) * 0.18 * lift, b.z)
        dummy.scale.setScalar(b.s * Math.max(0.01, s.intro))
        dummy.updateMatrix()
        mesh.setMatrixAt(i, dummy.matrix)
      })
      mesh.instanceMatrix.needsUpdate = true
    }
    for (const m of this.bubbles) {
      const b = m.userData
      m.position.set(b.x + Math.sin(t * 0.2 + b.ph) * 0.4, b.y + Math.sin(t * 0.35 + b.ph) * 0.35, b.z + Math.cos(t * 0.18 + b.ph) * 0.3)
      m.scale.setScalar(b.s * (1 + Math.sin(t * 1.3 + b.ph) * 0.015) * Math.max(0.01, s.intro) * (1 - s.chaos * 0.4))
    }
  }
}
