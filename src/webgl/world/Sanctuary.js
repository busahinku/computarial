import {
  AdditiveBlending, CircleGeometry, Color, CylinderGeometry, DoubleSide, ExtrudeGeometry, Group, Matrix4, Mesh,
  MeshStandardMaterial, NormalBlending, Path, RingGeometry, ShaderMaterial, Shape, TorusGeometry,
} from 'three'
import { SPOW } from './Sky.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

export const WALL_RADIUS = 8.8
const WALL_HEIGHT = 7.4
const SEGMENTS = 16

export const gold = new MeshStandardMaterial({ color: '#e6c992', metalness: 1, roughness: 0.24, envMapIntensity: 1.4 })

export class Sanctuary {
  constructor({ marble }) {
    this.group = new Group()

    const floorMap = marble.clone()
    floorMap.repeat.set(5, 5)
    const floorMat = new MeshStandardMaterial({ color: '#ffffff', map: floorMap, roughness: 0.2, envMapIntensity: 1.05 })
    const stoneMat = new MeshStandardMaterial({ color: '#fbfaf8', map: marble, roughness: 0.3, envMapIntensity: 1 })

    const floor = new Mesh(new CircleGeometry(9.6, 160).rotateX(-Math.PI / 2), floorMat)
    this.group.add(floor)
    const plinth = new Mesh(new CylinderGeometry(9.6, 9.9, 0.6, 160, 1, true), stoneMat)
    plinth.position.y = -0.3
    this.group.add(plinth)

    for (const r of [2.35, 2.42, 7.9]) {
      const inlay = new Mesh(new RingGeometry(r, r + 0.028, 256).rotateX(-Math.PI / 2), gold)
      inlay.position.y = 0.003
      this.group.add(inlay)
    }

    // Pedestal
    const tiers = [
      [1.62, 1.66, 0.16, 0.08],
      [1.3, 1.34, 0.5, 0.41],
      [1.44, 1.44, 0.1, 0.71],
    ]
    for (const [top, bottom, h, y] of tiers) {
      const m = new Mesh(new CylinderGeometry(top, bottom, h, 128), stoneMat)
      m.position.y = y
      this.group.add(m)
    }
    const band = new Mesh(new TorusGeometry(1.445, 0.012, 12, 200).rotateX(Math.PI / 2), gold)
    band.position.y = 0.76
    this.group.add(band)
    this.pedestalTop = 0.765

    // Soft light pool on the pedestal and a contact shadow on the floor
    const pool = new Mesh(
      new CircleGeometry(1.4, 96).rotateX(-Math.PI / 2),
      radial({ color: '#fff6e6', strength: 0.55, power: 1.6, blending: AdditiveBlending }),
    )
    pool.position.y = this.pedestalTop + 0.002
    this.group.add(pool)
    const shadow = new Mesh(new CircleGeometry(3.2, 96).rotateX(-Math.PI / 2), radial({ color: '#7d8799', strength: 0.22, power: 1.2 }))
    shadow.position.y = 0.004
    this.group.add(shadow)

    // Rotunda: arched wall segments merged into a single draw call
    const chord = 2 * WALL_RADIUS * Math.tan(Math.PI / SEGMENTS) + 0.02
    const opening = 2.1
    const shape = new Shape().moveTo(-chord / 2, 0).lineTo(chord / 2, 0).lineTo(chord / 2, WALL_HEIGHT).lineTo(-chord / 2, WALL_HEIGHT)
    const hole = new Path().moveTo(-opening / 2, 0.45).lineTo(opening / 2, 0.45).lineTo(opening / 2, 4.3)
    hole.absarc(0, 4.3, opening / 2, 0, Math.PI, false)
    hole.lineTo(-opening / 2, 0.45)
    shape.holes.push(hole)
    const segment = new ExtrudeGeometry(shape, { depth: 0.6, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 2, curveSegments: 32 })
    segment.translate(0, 0, -0.3)
    const parts = []
    for (let i = 0; i < SEGMENTS; i++) {
      const a = (i / SEGMENTS) * Math.PI * 2
      parts.push(segment.clone().applyMatrix4(new Matrix4().makeRotationY(a).multiply(new Matrix4().makeTranslation(0, 0, WALL_RADIUS))))
    }
    const walls = new Mesh(mergeGeometries(parts), new MeshStandardMaterial({ color: '#efece6', roughness: 0.66 }))
    this.group.add(walls)

    const beamMat = new MeshStandardMaterial({ color: '#f7f6f3', roughness: 0.55, side: DoubleSide })
    const r0 = WALL_RADIUS - 0.34, r1 = WALL_RADIUS + 0.4, y0 = WALL_HEIGHT + 0.035
    const beamParts = [
      new CylinderGeometry(r1, r1, 0.7, 160, 1, true).translate(0, y0 + 0.35, 0),
      new CylinderGeometry(r0, r0, 0.7, 160, 1, true).translate(0, y0 + 0.35, 0),
      new RingGeometry(r0, r1, 160).rotateX(Math.PI / 2).translate(0, y0, 0),
      new RingGeometry(r0, r1, 160).rotateX(-Math.PI / 2).translate(0, y0 + 0.7, 0),
    ]
    this.group.add(new Mesh(mergeGeometries(beamParts), beamMat))
    const cornice = new Mesh(new TorusGeometry(WALL_RADIUS - 0.34, 0.025, 8, 256).rotateX(Math.PI / 2), gold)
    cornice.position.y = WALL_HEIGHT
    this.group.add(cornice)

    // Light shaft from the open oculus onto the pedestal
    this.shaft = new Mesh(
      new CylinderGeometry(2.4, 1.35, 9, 64, 1, true),
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
        uniforms: { uStrength: { value: 0.07 }, uColor: { value: new Color('#fff4e2') } },
        vertexShader: /* glsl */ `${SPOW}
          varying float vY; varying float vFacing;
          void main() {
            vY = uv.y;
            vec3 n = normalize(normalMatrix * normal);
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vFacing = abs(dot(n, normalize(-mv.xyz)));
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `${SPOW}
          uniform float uStrength; uniform vec3 uColor;
          varying float vY; varying float vFacing;
          void main() {
            float a = spow(vFacing, 2.5) * smoothstep(0.0, 0.25, vY) * (1.0 - smoothstep(0.55, 1.0, vY));
            gl_FragColor = vec4(uColor * a * uStrength, 1.0);
          }`,
      }),
    )
    this.shaft.position.y = this.pedestalTop + 4.5
    this.group.add(this.shaft)
  }

  update(time, s) {
    this.shaft.material.uniforms.uStrength.value = 0.07 * (1 - s.chaos * 0.7)
  }
}

function radial({ color, strength, power, blending = NormalBlending }) {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending,
    uniforms: { uColor: { value: new Color(color) }, uStrength: { value: strength }, uPower: { value: power } },
    vertexShader: /* glsl */ `${SPOW}varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `${SPOW}
      uniform vec3 uColor; uniform float uStrength, uPower; varying vec2 vUv;
      void main() {
        float a = spow(1.0 - clamp(length(vUv - 0.5) * 2.0, 0.0, 1.0), uPower) * uStrength;
        gl_FragColor = vec4(uColor, a);
      }`,
  })
}
