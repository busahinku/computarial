import {
  Color, Euler, Group, InstancedMesh, MathUtils, Matrix4, Mesh, MeshPhysicalMaterial, Object3D, Quaternion,
  ShaderMaterial, SphereGeometry, TorusGeometry, BoxGeometry, Vector3,
} from 'three'
import { gold } from './Sanctuary.js'
import { BLOOM_CENTER, FAN_PIVOT, HALO_CENTER } from './Feathers.js'

const RADII = [1.3, 1.5, 1.72]
const SCALE = [0.95, 0.6, 0.8, 1.3, 1.5]
const HALO_EYE = new Vector3(0, 1.9, 6.8)
const HALO_BACK = new Vector3().subVectors(HALO_CENTER, HALO_EYE).normalize().multiplyScalar(0.6)
// Where the rings stand per chapter: behind the fan, around the dial, behind the device, behind the sky halo.
// Nothing solid ever shares their space, so no feather passes through gold.
const PLACES = [
  new Vector3(0, 2.7, -1.7),
  BLOOM_CENTER,
  BLOOM_CENTER,
  new Vector3(0.35, 2.4, -2.2),
  new Vector3().addVectors(HALO_CENTER, HALO_BACK),
]
const CORE = [FAN_PIVOT, BLOOM_CENTER, BLOOM_CENTER, BLOOM_CENTER, HALO_CENTER]
const CORE_SCALE = [0.85, 1, 1, 0, 1.4]

const _q = new Quaternion()
const _e = new Euler()
const _p = new Vector3()
const _m = new Matrix4()

export const pearl = new MeshPhysicalMaterial({
  color: '#fdfcfa', roughness: 0.14, clearcoat: 1, clearcoatRoughness: 0.08,
  iridescence: 1, iridescenceIOR: 1.35, iridescenceThicknessRange: [160, 540], envMapIntensity: 1.3,
})

// Three gold rings of an armillary sphere: time-keeping, the Flowtrack metaphor.
export class Armillary {
  constructor() {
    this.group = new Group()
    this.rings = RADII.map((r, i) => {
      const ring = new Mesh(new TorusGeometry(r, i === 2 ? 0.013 : 0.009, 12, 320), gold)
      ring.userData = { cur: new Quaternion(), a: new Quaternion(), b: new Quaternion() }
      this.group.add(ring)
      return ring
    })

    const outer = this.rings[2]
    const ticks = new InstancedMesh(new BoxGeometry(0.008, 1, 0.008), gold, 12)
    const dummy = new Object3D()
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2
      const len = i % 3 === 0 ? 0.16 : 0.08
      dummy.position.set(Math.cos(a) * (RADII[2] + 0.04 + len / 2), Math.sin(a) * (RADII[2] + 0.04 + len / 2), 0)
      dummy.rotation.set(0, 0, a - Math.PI / 2)
      dummy.scale.set(1, len, 1)
      dummy.updateMatrix()
      ticks.setMatrixAt(i, dummy.matrix)
    }
    outer.add(ticks)

    this.arc = new Mesh(
      new TorusGeometry(RADII[2], 0.024, 12, 320),
      new ShaderMaterial({
        transparent: true,
        uniforms: { uArc: { value: 0 }, uColor: { value: new Color('#f3d49c').multiplyScalar(2.2) } },
        vertexShader: /* glsl */ `
          varying float vAngle;
          void main() {
            vAngle = atan(position.x, position.y);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform float uArc; uniform vec3 uColor; varying float vAngle;
          void main() {
            float a = fract(vAngle / 6.28318 + 1.0);
            if (a > uArc) discard;
            float head = smoothstep(uArc - 0.04, uArc, a);
            gl_FragColor = vec4(uColor * (1.0 + head * 1.5), 1.0);
          }`,
      }),
    )
    outer.add(this.arc)

    this.core = new Mesh(new SphereGeometry(0.17, 48, 24), pearl)
    this.core.position.copy(FAN_PIVOT)
    this.group.position.copy(PLACES[0])
    this.cur = { p: PLACES[0].clone(), s: SCALE[0], core: FAN_PIVOT.clone(), coreScale: 0 }
  }

  #pose(stage, i, t, q) {
    switch (stage) {
      case 0:
        return q.setFromEuler(_e.set(0.1 * Math.sin(t * 0.25 + i * 2), 0.18 * Math.sin(t * 0.2 + i), (i ? (i === 1 ? 1 : -1) : 0) * t * 0.04, 'YXZ'))
      case 1:
        return q.setFromEuler(_e.set(t * 0.9 * (i + 1) + i, t * 0.6 + i * 2, t * 0.4 * (2 - i), 'XYZ'))
      case 2:
        return q.setFromEuler(_e.set(0, 0, i === 2 ? 0 : (i ? 1 : -1) * t * 0.08))
      case 3:
        return q.setFromEuler(_e.set(0.12 * Math.sin(t * 0.3 + i * 2), -0.35 + 0.15 * Math.sin(t * 0.25 + i), i ? (i === 1 ? 1 : -1) * t * 0.05 : 0, 'YXZ'))
      default:
        _m.lookAt(HALO_EYE, HALO_CENTER, _p.set(0, 1, 0))
        return q.setFromRotationMatrix(_m).multiply(_q.setFromEuler(_e.set(0, 0, t * 0.04 * (i + 1))))
    }
  }

  update(t, dt, s) {
    const f = MathUtils.clamp(s.formation, 0, 4)
    const base = Math.min(Math.floor(f), 3)
    const frac = MathUtils.smoothstep(f - base, 0, 1)
    const k = 1 - Math.exp(-3.2 * dt)

    for (const [i, ring] of this.rings.entries()) {
      const d = ring.userData
      this.#pose(base, i, t, d.a).slerp(this.#pose(base + 1, i, t, d.b), frac)
      ring.quaternion.copy(d.cur.slerp(d.a, k))
    }

    this.cur.p.lerp(_p.lerpVectors(PLACES[base], PLACES[base + 1], frac), k)
    this.cur.core.lerp(_p.lerpVectors(CORE[base], CORE[base + 1], frac), k)
    this.cur.s += (MathUtils.lerp(SCALE[base], SCALE[base + 1], frac) - this.cur.s) * k
    const intro = MathUtils.smoothstep(s.intro, 0.2, 1)
    this.group.position.copy(this.cur.p)
    this.group.scale.setScalar(this.cur.s * (0.6 + 0.4 * intro))

    this.arc.material.uniforms.uArc.value = s.focus * 0.72
    this.arc.visible = s.focus > 0.001
    this.cur.coreScale += (MathUtils.lerp(CORE_SCALE[base], CORE_SCALE[base + 1], frac) * intro - this.cur.coreScale) * k
    this.core.position.copy(this.cur.core)
    this.core.scale.setScalar(Math.max(0.01, this.cur.coreScale))
  }
}
