import { BackSide, Color, Group, Mesh, PlaneGeometry, ShaderMaterial, SphereGeometry, Sprite, SpriteMaterial } from 'three'

// Metal can return NaN for pow(0, y); every shader uses this guard instead.
export const SPOW = '#define spow(x, y) pow(max(x, 1e-5), y)\n'

export const NOISE = /* glsl */ `
  float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float s = 0.0, a = 0.5;
    mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
    for (int i = 0; i < 4; i++) { s += a * noise(p); p = m * p; a *= 0.5; }
    return s;
  }
`

export const HORIZON = new Color('#edf2f8')

export class Sky {
  constructor({ cloud, sunDir }) {
    this.group = new Group()
    this.uniforms = {
      uTime: { value: 0 },
      uSunDir: { value: sunDir },
      uZenith: { value: new Color('#96b7de') },
      uHorizon: { value: HORIZON },
      uSun: { value: new Color('#fff0d6') },
      uChaos: { value: 0 },
      uHalo: { value: 0 },
    }

    const dome = new Mesh(
      new SphereGeometry(400, 48, 24),
      new ShaderMaterial({
        side: BackSide,
        depthWrite: false,
        uniforms: this.uniforms,
        vertexShader: /* glsl */ `${SPOW}
          varying vec3 vDir;
          void main() {
            vDir = position;
            vec4 p = projectionMatrix * modelViewMatrix * vec4(position + cameraPosition, 1.0);
            gl_Position = p.xyww;
          }`,
        fragmentShader: /* glsl */ `${SPOW}
          uniform vec3 uZenith, uHorizon, uSun, uSunDir;
          uniform float uTime, uChaos, uHalo;
          varying vec3 vDir;
          ${NOISE}
          void main() {
            vec3 d = normalize(vDir);
            float h = d.y;
            vec3 col = mix(uHorizon, uZenith, spow(smoothstep(-0.02, 0.65, h), 0.85));
            float sd = max(dot(d, normalize(uSunDir)), 0.0);
            col = mix(col, uSun, spow(sd, 5.0) * 0.4);
            if (h > 0.0) {
              vec2 p = d.xz / (h + 0.18) * 1.3 + vec2(uTime * 0.004, uTime * 0.0015);
              float c = fbm(p * 1.4 + fbm(p * 0.7) * 1.3);
              c = smoothstep(0.48, 0.86, c) * smoothstep(0.02, 0.3, h);
              col = mix(col, vec3(1.0), c * 0.6);
            }
            col += uSun * (spow(sd, 1200.0) * 8.0 + spow(sd, 70.0) * 0.4 * (1.0 + uHalo * 1.5) + spow(sd, 7.0) * 0.18 * uHalo);
            float l = dot(col, vec3(0.299, 0.587, 0.114));
            col = mix(col, vec3(l) * vec3(0.97, 0.98, 1.0), uChaos * 0.5);
            gl_FragColor = vec4(col, 1.0);
          }`,
      }),
    )
    dome.renderOrder = -10
    dome.frustumCulled = false
    this.group.add(dome)

    const sea = new Mesh(
      new PlaneGeometry(1200, 1200).rotateX(-Math.PI / 2),
      new ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: /* glsl */ `${SPOW}
          varying vec3 vWorld;
          void main() {
            vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
            gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
          }`,
        fragmentShader: /* glsl */ `${SPOW}
          uniform vec3 uHorizon, uSun, uSunDir;
          uniform float uTime, uChaos;
          varying vec3 vWorld;
          ${NOISE}
          void main() {
            vec2 p = vWorld.xz * 0.02 + vec2(uTime * 0.008, uTime * 0.004);
            vec2 w = p + fbm(p * 0.6 - uTime * 0.004) * 1.6;
            float n = fbm(w);
            float lit = fbm(w + normalize(uSunDir.xz) * 0.05);
            float tops = smoothstep(0.32, 0.78, n);
            vec3 valley = vec3(0.74, 0.8, 0.9);
            vec3 col = mix(valley, vec3(1.0), tops) + uSun * clamp((n - lit) * 3.0, 0.0, 0.25);
            float dist = length(vWorld.xz - cameraPosition.xz);
            col = mix(col, uHorizon, smoothstep(40.0, 380.0, dist));
            gl_FragColor = vec4(col, 1.0);
          }`,
      }),
    )
    sea.position.y = -2.4
    this.group.add(sea)

    // Billboard cumulus drifting outside the rotunda
    this.clouds = new Group()
    const rnd = mulberry(11)
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + rnd() * 0.3
      const r = 17 + rnd() * 70
      const sprite = new Sprite(
        new SpriteMaterial({ map: cloud, fog: true, depthWrite: false, transparent: true, opacity: 0.75 + rnd() * 0.25 }),
      )
      const w = 14 + rnd() * 26 + r * 0.25
      sprite.scale.set(w, w * (0.42 + rnd() * 0.15), 1)
      sprite.position.set(Math.sin(a) * r, -2.2 + rnd() * 3 + r * 0.02, Math.cos(a) * r)
      sprite.renderOrder = -5
      this.clouds.add(sprite)
    }
    this.group.add(this.clouds)
  }

  update(time, s) {
    this.uniforms.uTime.value = time
    this.uniforms.uChaos.value = s.chaos
    this.uniforms.uHalo.value = s.halo
    this.clouds.rotation.y = time * 0.006
  }
}

export function mulberry(seed) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
