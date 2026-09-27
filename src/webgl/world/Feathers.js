import {
  Color, DoubleSide, InstancedBufferAttribute, InstancedMesh, MathUtils, Matrix4, PlaneGeometry, Quaternion,
  ShaderMaterial, UniformsLib, UniformsUtils, Vector3,
} from 'three'
import { mulberry, SPOW } from './Sky.js'

export const BLOOM_CENTER = new Vector3(0, 2.35, 0)
export const HALO_CENTER = new Vector3(0, 8.3, -3.2)
// Pearl rivet the hero fan turns on
export const FAN_PIVOT = new Vector3(0, 1.3, 0.35)
const HALO_EYE = new Vector3(0, 1.9, 6.8)

const vertexShader = /* glsl */ `${SPOW}
  attribute vec4 aShape;   // seed, asymmetry, bend, width
  attribute vec4 aShape2;  // flutter speed, twist, hue, flutter amount
  uniform float uTime, uCup;
  varying vec2 vUv;
  varying float vHalfW;
  varying vec3 vNormal;
  varying vec3 vWorld;
  varying float vSeed;
  varying float vHue;
  #include <fog_pars_vertex>

  const float QUILL = 0.09;

  float profile(float u) {
    float t = clamp((u - QUILL) / (1.0 - QUILL), 0.0, 1.0);
    return smoothstep(0.0, 0.22, t) * sqrt(max(1.0 - spow(t, 3.2), 0.0));
  }

  float halfWidth(float v, float u) {
    float side = v < 0.0 ? aShape.y : 1.0;
    float shaft = mix(0.011, 0.002, u);
    return max(aShape.w * 0.2 * profile(u) * side, shaft);
  }

  vec3 shape(float v, float u) {
    float d = abs(v) * halfWidth(v, u);
    vec3 p = vec3(v < 0.0 ? -d : d, u + d * 0.6, -d * d * uCup);
    p.z += aShape.z * u * u * 0.4;
    float tw = aShape2.y * u;
    p.xz = mat2(cos(tw), -sin(tw), sin(tw), cos(tw)) * p.xz;
    float ph = uTime * aShape2.x + aShape.x * 6.2831;
    p.z += (sin(ph + u * 4.5) * 0.03 * u + sin(ph * 1.7 + d * 18.0) * 0.05 * d) * aShape2.w;
    return p;
  }

  void main() {
    float v = position.x;
    float u = position.y;
    vec3 p = shape(v, u);
    float dv = v < 0.0 ? -0.02 : 0.02;
    vec3 tu = shape(v, u + 0.01) - p;
    vec3 tv = (shape(v + dv, u) - p) * sign(dv);
    vec3 n = normalize(cross(tv, tu));

    mat4 world = modelMatrix * instanceMatrix;
    vec4 wp = world * vec4(p, 1.0);
    vWorld = wp.xyz;
    vNormal = normalize(mat3(world) * n);
    vUv = vec2(v, u);
    vHalfW = halfWidth(v, u);
    vSeed = aShape.x;
    vHue = aShape2.z;
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`

const fragmentShader = /* glsl */ `${SPOW}
  uniform vec3 uSunDir, uKeyDir, uSun, uSky, uGround, uBase;
  uniform float uIri, uAlphaCut, uTime;
  varying vec2 vUv;
  varying float vHalfW;
  varying vec3 vNormal;
  varying vec3 vWorld;
  varying float vSeed;
  varying float vHue;
  #include <fog_pars_fragment>

  const float QUILL = 0.09;
  float h1(float n) { return fract(sin(n) * 43758.5453); }

  void main() {
    float v = vUv.x, u = vUv.y;
    float av = abs(v);
    float d = av * vHalfW;

    float shaftW = mix(0.009, 0.0015, u);
    float shaft = 1.0 - smoothstep(shaftW * 0.55, shaftW, d);

    // Barbs run across the vane; the geometry sweeps them toward the tip.
    float s = u * 230.0 - spow(av, 1.4) * 5.0;
    float fw = fwidth(s);
    float fine = mix(0.5 + 0.5 * cos(6.2831 * s), 0.5, smoothstep(0.25, 0.75, fw));
    // Barbs cling in irregular clumps; some clumps part, leaving the thin splits real vanes show
    float c = u * 30.0 - spow(av, 1.25) * 1.8;
    float jit = h1(floor(c) + vSeed * 7.0);
    float split = (1.0 - smoothstep(0.0, 0.08 + fwidth(c), fract(c))) * step(0.55, jit) * smoothstep(0.15, 0.45, av);
    float barb = 0.5 + 0.25 * fine + 0.25 * jit - 0.55 * split;

    float cluster = floor(s / 6.0);
    float gap = step(0.93, h1(cluster + vSeed * 91.7)) * smoothstep(0.25, 0.6, av);
    // Ragged vane edge that varies per clump (not per barb, which aliases into a dotted rim),
    // antialiased with screen-space derivatives so it stays clean at 4K and on phones alike
    float fc = u * 30.0 + vSeed * 7.0;
    float fringe = mix(h1(floor(fc)), h1(floor(fc) + 1.0), smoothstep(0.0, 1.0, fract(fc))) * 0.06;
    float aw = fwidth(av);
    float edge = 1.0 - smoothstep(0.84 - fringe - aw, 1.0 - fringe * 0.5 + aw, av);

    float t = (u - QUILL) / (1.0 - QUILL);
    float down = smoothstep(0.02, 0.26, t);
    float alpha = edge * mix(0.25 + 0.35 * barb, 1.0, down) * (1.0 - gap * 0.85) * (1.0 - split * 0.6 * smoothstep(0.6, 0.95, av));
    alpha = max(alpha * step(QUILL, u), shaft);
    if (alpha < uAlphaCut) discard;

    vec3 N = normalize(vNormal);
    if (!gl_FrontFacing) N = -N;
    vec3 V = normalize(cameraPosition - vWorld);
    vec3 L = normalize(uSunDir);
    float ndl = dot(N, L);

    // Front key gives form (white on white needs a shadow side); the sun behind supplies the rim
    float key = smoothstep(-0.6, 0.85, dot(N, normalize(uKeyDir)));
    vec3 ambient = mix(uGround, uSky, N.y * 0.5 + 0.5);
    vec3 col = uBase * mix(ambient * vec3(0.7, 0.73, 0.83), vec3(0.9), key);
    col *= 1.0 - 0.1 * (1.0 - smoothstep(0.0, 0.18, av));
    col *= 0.8 + 0.26 * barb;

    float trans = spow(clamp(dot(V, -L), 0.0, 1.0), 4.0) * (1.0 - key * 0.5);
    col += uSun * trans * 0.14 * smoothstep(0.45, 1.0, av);

    float F = spow(1.0 - abs(dot(N, V)), 2.0);
    vec3 film = 0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + F * 1.2 + vHue + ndl * 0.3 + u * 0.45));
    col = mix(col, col * (0.78 + 0.46 * film), uIri * (0.12 + 0.88 * F));

    vec3 R = reflect(-normalize(uKeyDir), N);
    col += uSun * spow(max(dot(R, V), 0.0), 14.0) * 0.28 * (0.3 + 0.7 * barb);
    col = mix(col, col * vec3(0.93, 0.91, 0.87), shaft * 0.85);

    gl_FragColor = vec4(col, alpha);
    #include <fog_fragment>
  }
`

const _m = new Matrix4()
const _x = new Vector3()
const _y = new Vector3()
const _z = new Vector3()
const _s = new Vector3()
const _v = new Vector3()
const _w = new Vector3()
const _q = new Quaternion()
const _c = new Vector3()
const _eye = new Vector3()
const UP = new Vector3(0, 1, 0)
const FRONT = new Vector3(0, 0, 1)

const _ox = new Vector3()
const _oy = new Vector3()
const _oz = new Vector3()
const _om = new Matrix4()
const _axis = new Vector3()

function orient(q, along, normal) {
  _oy.copy(along).normalize()
  _ox.crossVectors(_oy, normal).normalize()
  _oz.crossVectors(_ox, _oy)
  return q.setFromRotationMatrix(_om.makeBasis(_ox, _oy, _oz))
}

const pose = () => ({ p: new Vector3(), q: new Quaternion(), s: 1 })
const smooth01 = (x) => MathUtils.smoothstep(x, 0, 1)
const byDepth = (a, b) => b.depth - a.depth
const wrap = (x, a, b) => a + ((((x - a) % (b - a)) + (b - a)) % (b - a))

export class Feathers {
  constructor({ tier, sunDir, pointer }) {
    const high = tier === 'high'
    this.pointer = pointer
    this.uniforms = UniformsUtils.merge([
      UniformsLib.fog,
      {
        uTime: { value: 0 },
        uCup: { value: 2.6 },
        uSunDir: { value: null },
        uKeyDir: { value: new Vector3(-0.45, 0.75, 0.55).normalize() },
        uSun: { value: new Color('#fff6ec').multiplyScalar(1.1) },
        uSky: { value: new Color('#d8e1ee') },
        uGround: { value: new Color('#f6f1ea') },
        uBase: { value: new Color('#fdfcfa') },
        uIri: { value: 0.6 },
        uAlphaCut: { value: 0.02 },
      },
    ])
    this.uniforms.uSunDir.value = sunDir
    this.material = new ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader,
      fragmentShader,
      side: DoubleSide,
      fog: true,
      // Blended (not alpha-to-coverage, which dithers on Apple GPUs); instances are depth-sorted each frame.
      transparent: true,
    })

    const rnd = mulberry(5)
    this.heroData = Array.from({ length: 16 }, (_, i) => ({
      i,
      len: 1.7 + rnd() * 0.45,
      delay: rnd() * 0.45,
      k: 2.2 + rnd() * 2.2,
      spin: 0.6 + rnd() * 1.4,
      axis: new Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize(),
      scatter: new Vector3().setFromSphericalCoords(1.6 + rnd() * 3.6, Math.acos(rnd() * 1.6 - 0.8), rnd() * Math.PI * 2),
      x0: rnd() * 14,
      cur: pose(),
      a: pose(),
      b: pose(),
      shape: [rnd(), 0.55 + rnd() * 0.25, -(0.06 + rnd() * 0.1), 0.95 + rnd() * 0.25],
      shape2: [1.2 + rnd() * 1.2, (rnd() - 0.5) * 0.5, rnd(), 1],
    }))
    this.driftData = Array.from({ length: high ? 90 : 36 }, (_, i) => ({
      i,
      size: 0.32 + rnd() * 0.32,
      fall: 0.14 + rnd() * 0.2,
      base: new Vector3((rnd() - 0.5) * 15, rnd() * 11 - 0.5, (rnd() - 0.5) * 13),
      sway: 0.3 + rnd() * 0.6,
      freq: 0.3 + rnd() * 0.5,
      spin: 0.2 + rnd() * 0.6,
      lane: i % 7,
      x0: rnd() * 15,
      delay: rnd(),
      p: new Vector3(),
      q: new Quaternion(),
      lq: new Quaternion(),
      shape: [rnd(), 0.75 + rnd() * 0.25, -(0.25 + rnd() * 0.45), 1.1 + rnd() * 0.35],
      shape2: [1.6 + rnd() * 1.6, (rnd() - 0.5) * 0.8, rnd(), 1.6],
    }))

    // Hero vanes cup less so the shingled fan layers stay clear of each other
    const heroMaterial = this.material.clone()
    heroMaterial.uniforms = { ...this.uniforms, uCup: { value: 0.7 } }
    this.hero = this.#mesh(this.heroData, heroMaterial)
    this.drift = this.#mesh(this.driftData, this.material)
    this.meshes = [this.hero, this.drift]
    this.primed = false
  }

  #mesh(data, material) {
    const geometry = new PlaneGeometry(2, 1, 12, 44).translate(0, 0.5, 0)
    geometry.setAttribute('aShape', new InstancedBufferAttribute(new Float32Array(data.flatMap((d) => d.shape)), 4))
    geometry.setAttribute('aShape2', new InstancedBufferAttribute(new Float32Array(data.flatMap((d) => d.shape2)), 4))
    const mesh = new InstancedMesh(geometry, material, data.length)
    data.forEach((d) => (d.m = new Matrix4()))
    mesh.frustumCulled = false
    return mesh
  }

  // Cursor push, kept in the screen plane so feathers never shove through one another
  #repel(p, radius, push) {
    _v.subVectors(p, this.pointer).setZ(0)
    const d = _v.length()
    if (d < radius && d > 1e-4) p.addScaledVector(_v, ((1 - d / radius) ** 2 * push) / d)
  }

  // Loose feathers slide around solid objects instead of passing through them
  #avoid(p, center, radius, weight) {
    if (weight <= 0) return
    _v.subVectors(p, center)
    const d = _v.length()
    if (d < radius && d > 1e-4) p.addScaledVector(_v, ((radius - d) * weight) / d)
  }

  // Far-to-near order so blended vanes composite correctly; per-instance shape data travels along.
  #commit(mesh, data) {
    const shape = mesh.geometry.attributes.aShape
    const shape2 = mesh.geometry.attributes.aShape2
    // Persistent order array sorted in place: frame to frame it is nearly sorted and allocates nothing
    const order = (mesh.userData.order ??= data.slice())
    order.sort(byDepth)
    order.forEach((f, k) => {
      mesh.setMatrixAt(k, f.m)
      shape.array.set(f.shape, k * 4)
      shape2.array.set(f.shape2, k * 4)
    })
    mesh.instanceMatrix.needsUpdate = shape.needsUpdate = shape2.needsUpdate = true
  }

  // Formation poses for the hero feathers, one per story stage.
  #formation(index, f, t, out) {
    const n = this.heroData.length
    switch (index) {
      case 0: {
        // Fan: feathers shingled on a pearl rivet, each on its own layer so none intersect.
        // The fan breathes, and parts around the cursor.
        const k = f.i / (n - 1)
        let a = (k - 0.5) * (1.9 + Math.sin(t * 0.45) * 0.08)
        out.s = f.len
        const mx = FAN_PIVOT.x + Math.sin(a) * out.s * 0.6 - this.pointer.x
        const my = FAN_PIVOT.y + Math.cos(a) * out.s * 0.6 - this.pointer.y
        const d = Math.hypot(mx, my)
        if (d < 1.2) a += Math.sign(mx * Math.cos(a) - my * Math.sin(a)) * (1 - d / 1.2) ** 2 * 0.22
        _w.set(Math.sin(a), Math.cos(a), 0)
        _axis.copy(FRONT).applyAxisAngle(_w, 0.16)
        orient(out.q, _w, _axis)
        out.p.copy(FAN_PIVOT).addScaledVector(FRONT, -f.i * 0.05)
        _q.setFromAxisAngle(UP, Math.sin(t * 0.3) * 0.18)
        out.p.sub(FAN_PIVOT).applyQuaternion(_q).add(FAN_PIVOT)
        out.q.premultiply(_q)
        break
      }
      case 1: {
        out.p.copy(f.scatter).add(BLOOM_CENTER)
        out.p.x += Math.sin(t * 0.6 + f.i) * 0.4
        out.p.y += Math.cos(t * 0.8 + f.i * 1.3) * 0.3
        out.q.setFromAxisAngle(f.axis, t * f.spin + f.i)
        out.s = f.len * 0.7
        break
      }
      case 2: {
        const lane = f.i % 5
        const x = wrap(f.x0 + t * 0.85, -7.5, 7.5)
        const phase = x * 0.55 + t * 0.7 + lane
        out.p.set(x, BLOOM_CENTER.y + (lane - 2) * 0.44 + Math.sin(phase) * 0.12, lane % 2 ? 0.5 : -0.45)
        _w.set(1, Math.cos(phase) * 0.066, 0)
        _v.copy(FRONT).applyAxisAngle(_axis.copy(_w).normalize(), Math.sin(t * 0.9 + f.i) * 0.35)
        orient(out.q, _w, _v)
        out.s = f.len * 0.52 * MathUtils.smoothstep(7.3 - Math.abs(x), 0, 1.4)
        break
      }
      case 3: {
        const a = (f.i / n) * Math.PI * 2 + t * 0.2
        const r = 2.1 + Math.sin(a * 3 + t) * 0.08
        _v.set(Math.cos(a) * r, Math.sin(a * 2 + t * 0.5) * 0.12, Math.sin(a) * r).applyAxisAngle(_x.set(1, 0, 0), 0.8)
        out.p.copy(BLOOM_CENTER).add(_v)
        _w.set(-Math.sin(a), 0, Math.cos(a)).applyAxisAngle(_x, 0.8)
        orient(out.q, _w, _y.copy(UP).applyAxisAngle(_x, 0.8))
        out.s = f.len * 0.42
        break
      }
      default: {
        _z.subVectors(HALO_EYE, HALO_CENTER).normalize()
        _x.crossVectors(UP, _z).normalize()
        _y.crossVectors(_z, _x)
        const ring = f.i % 2
        const a = (f.i / n) * Math.PI * 2 + ring * (Math.PI / n) + t * 0.045
        _v.copy(_x).multiplyScalar(Math.cos(a)).addScaledVector(_y, Math.sin(a))
        out.p.copy(HALO_CENTER).addScaledVector(_v, ring ? 1.2 : 0.62).addScaledVector(_z, ring ? -0.06 : 0.06)
        orient(out.q, _v, _z)
        out.s = f.len * (ring ? 1.3 : 0.98)
      }
    }
    return out
  }

  update(t, dt, s, eye) {
    this.uniforms.uTime.value = t
    const formation = MathUtils.clamp(s.formation, 0, 4)
    const base = Math.min(Math.floor(formation), 3)
    const frac = formation - base
    const intro = s.intro

    for (const f of this.heroData) {
      const local = smooth01(MathUtils.clamp((frac - f.delay * 0.45) / 0.55, 0, 1))
      const a = this.#formation(base, f, t, f.a)
      const b = this.#formation(base + 1, f, t, f.b)
      a.p.lerp(b.p, local)
      a.p.y += Math.sin(local * Math.PI) * 0.7
      a.q.slerp(b.q, local)
      a.s = MathUtils.lerp(a.s, b.s, local)

      const unfurl = smooth01(MathUtils.clamp(intro * 1.7 - f.delay, 0, 1))
      a.s *= 0.15 + 0.85 * unfurl

      const c = f.cur
      if (!this.primed || c.p.distanceToSquared(a.p) > 16) {
        c.p.copy(a.p)
        c.q.copy(a.q)
        c.s = a.s
      } else {
        const k = 1 - Math.exp(-f.k * dt)
        c.p.lerp(a.p, k)
        c.q.slerp(a.q, k)
        c.s += (a.s - c.s) * k
      }
      f.m.compose(c.p, c.q, _s.setScalar(Math.max(c.s, 1e-3)))
      f.depth = c.p.distanceToSquared(eye)
    }
    this.#commit(this.hero, this.heroData)
    this.primed = true

    _eye.subVectors(eye, BLOOM_CENTER).normalize()
    const speed = 1 + s.chaos * 2.6
    for (const f of this.driftData) {
      f.base.y -= f.fall * dt * speed
      if (f.base.y < -0.8) f.base.y += 12
      const swirl = t * 1.4 + f.i
      f.p.set(
        f.base.x + Math.sin(t * f.freq + f.i) * f.sway + Math.cos(swirl) * s.chaos * 1.1,
        f.base.y + Math.sin(swirl * 1.3) * s.chaos * 0.5,
        f.base.z + Math.cos(t * f.freq * 0.8 + f.i) * f.sway + Math.sin(swirl) * s.chaos * 1.1,
      )
      f.q.setFromAxisAngle(_v.set(Math.sin(f.i), 1, Math.cos(f.i * 1.7)).normalize(), t * f.spin * speed + f.i)
      _q.setFromAxisAngle(_w.set(1, 0, 0), Math.sin(t * 0.7 + f.i) * 0.9 + 0.5)
      f.q.multiply(_q)
      let size = f.size * (0.2 + 0.8 * smooth01(MathUtils.clamp(intro * 1.4 - f.delay * 0.3, 0, 1)))

      const w = smooth01(MathUtils.clamp(s.flow * 1.5 - f.delay * 0.5, 0, 1))
      if (w > 0) {
        const x = wrap(f.x0 + t * (0.9 + f.delay * 0.5), -7.5, 7.5)
        const phase = x * 0.55 + t * 0.7 + f.lane
        _v.set(x, BLOOM_CENTER.y + (f.lane - 3) * 0.3 + Math.sin(phase) * 0.12, (f.lane % 2 ? 1 : -1) * (0.4 + (f.lane % 3) * 0.16))
        f.p.lerp(_v, w)
        orient(f.lq, _w.set(1, Math.cos(phase) * 0.066, 0), FRONT)
        f.q.slerp(f.lq, w)
        size *= MathUtils.lerp(1, 0.8 * MathUtils.smoothstep(7.3 - Math.abs(x), 0, 1.4), w)
      }
      this.#repel(f.p, 1.4, 0.45)
      this.#avoid(f.p, _c.copy(BLOOM_CENTER).setZ(0.1), 2.35, MathUtils.clamp(1 - formation, 0, 1))
      this.#avoid(f.p, BLOOM_CENTER, 1.9, s.device)
      if (s.device > 0.01) {
        // Loose feathers between the camera and the screen shrink away so the display stays readable
        _v.subVectors(f.p, BLOOM_CENTER)
        const along = _v.dot(_eye)
        if (along > 0) size *= 1 - s.device * MathUtils.smoothstep(1.9 - Math.sqrt(Math.max(0, _v.lengthSq() - along * along)), 0, 0.6)
      }
      this.#avoid(f.p, HALO_CENTER, 4.3, s.halo)
      f.m.compose(f.p, f.q, _s.setScalar(Math.max(size, 1e-3)))
      f.depth = f.p.distanceToSquared(eye)
    }
    this.#commit(this.drift, this.driftData)
  }
}
