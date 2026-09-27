// Synthesizes the soundscape offline (additive pads, FM-free bells, filtered noise)
// and encodes it with ffmpeg to WebM/Opus + MP3. Run with `npm run audio`.
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SR = 44100
const OUT = new URL('../public/audio/', import.meta.url)
await mkdir(OUT, { recursive: true })

const TAU = Math.PI * 2
let seed = 7
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1

function biquadBandpass(input, freqAt, q) {
  const out = new Float32Array(input.length)
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0
  for (let i = 0; i < input.length; i++) {
    const w = (TAU * freqAt(i)) / SR, alpha = Math.sin(w) / (2 * q), a0 = 1 + alpha
    const b0 = alpha / a0, b2 = -alpha / a0, a1 = (-2 * Math.cos(w)) / a0, a2 = (1 - alpha) / a0
    const y = b0 * input[i] + b2 * x2 - a1 * y1 - a2 * y2
    x2 = x1; x1 = input[i]; y2 = y1; y1 = y
    out[i] = y
  }
  return out
}

// Freeverb topology: 8 damped combs + 4 allpasses per channel
function reverb([L, R], { room = 0.84, damp = 0.35, wet = 0.35 } = {}) {
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617]
  const passes = [556, 441, 341, 225]
  const run = (input, spread) => {
    const out = new Float32Array(input.length)
    for (const c of combs) {
      const buf = new Float32Array(c + spread)
      let idx = 0, store = 0
      for (let i = 0; i < input.length; i++) {
        const y = buf[idx]
        store = y * (1 - damp) + store * damp
        buf[idx] = input[i] * 0.015 + store * room
        idx = (idx + 1) % buf.length
        out[i] += y
      }
    }
    for (const a of passes) {
      const buf = new Float32Array(a + spread)
      let idx = 0
      for (let i = 0; i < out.length; i++) {
        const y = buf[idx]
        buf[idx] = out[i] + y * 0.5
        out[i] = y - out[i]
        idx = (idx + 1) % buf.length
      }
    }
    return out
  }
  const wl = run(L, 0), wr = run(R, 23)
  return [L.map((v, i) => v * (1 - wet) + wl[i] * wet * 3), R.map((v, i) => v * (1 - wet) + wr[i] * wet * 3)]
}

function normalize([L, R], peak) {
  let max = 0
  for (let i = 0; i < L.length; i++) max = Math.max(max, Math.abs(L[i]), Math.abs(R[i]))
  const g = peak / max
  return [L.map((v) => v * g), R.map((v) => v * g)]
}

function wav([L, R]) {
  const n = L.length, buf = Buffer.alloc(44 + n * 4)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVEfmt ', 8)
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22)
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(n * 4, 40)
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i])) * 32767), 44 + i * 4)
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i])) * 32767), 46 + i * 4)
  }
  return buf
}

async function encode(name, stereo, kbps) {
  const tmp = join(tmpdir(), `${name}.wav`)
  await writeFile(tmp, wav(stereo))
  const out = (ext) => new URL(`${name}.${ext}`, OUT).pathname
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', tmp, '-c:a', 'libopus', '-b:a', `${kbps}k`, out('webm')])
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', tmp, '-c:a', 'libmp3lame', '-b:a', `${kbps + 32}k`, out('mp3')])
  await rm(tmp)
  console.log(`  ${name}.webm / ${name}.mp3`)
}

// Ambient pad: Dmaj9(#11) voicing. Every frequency and LFO is snapped to whole
// cycles per loop so the second rendered period (with reverb tail) loops seamlessly.
function ambient() {
  const LOOP = 48, n = LOOP * SR
  const snap = (f) => Math.round(f * LOOP) / LOOP
  const voices = [
    [146.83, 0.30, 1], [220.0, 0.24, 2], [329.63, 0.2, 3], [369.99, 0.16, 2],
    [554.37, 0.1, 3], [659.25, 0.07, 4], [880.0, 0.035, 6],
  ]
  const L = new Float32Array(n * 2), R = new Float32Array(n * 2)
  const air = new Float32Array(n).map(() => rand())
  const airLoop = new Float32Array(n * 2).map((_, i) => air[i % n])
  const airBand = biquadBandpass(airLoop, () => 1400, 0.5)
  for (let i = 0; i < n * 2; i++) {
    const t = i / SR
    let l = 0, r = 0
    voices.forEach(([f0, amp, m], k) => {
      const swell = 0.55 + 0.45 * Math.sin((TAU * t * m) / LOOP + k * 1.7)
      const pan = 0.5 + 0.35 * Math.sin((TAU * t) / LOOP + k * 2.1)
      let s = 0
      for (const d of [-1, 0, 1]) s += Math.sin(TAU * snap(f0 * (1 + d * 0.0016)) * t + k + d)
      s += 0.12 * Math.sin(TAU * snap(f0 * 2) * t)
      s *= (amp * swell) / 3
      l += s * (1 - pan)
      r += s * pan
    })
    const breath = 0.035 * (0.6 + 0.4 * Math.sin((TAU * t * 2) / LOOP))
    L[i] = l + airBand[i] * breath
    R[i] = r + airBand[(i + 997) % (n * 2)] * breath
  }
  const [wl, wr] = reverb([L, R], { room: 0.88, damp: 0.4, wet: 0.45 })
  return normalize([wl.slice(n), wr.slice(n)], 0.7)
}

function chime() {
  const n = Math.round(3.2 * SR)
  const L = new Float32Array(n), R = new Float32Array(n)
  const notes = [[987.77, 0, 0.35], [1318.51, 0.09, 0.65]]
  const partials = [[1, 1, 2.4], [2.0, 0.42, 1.5], [3.01, 0.2, 0.9], [4.16, 0.1, 0.55], [5.43, 0.06, 0.35]]
  for (const [f0, delay, pan] of notes) {
    const start = Math.round(delay * SR)
    for (let i = start; i < n; i++) {
      const t = (i - start) / SR
      const attack = Math.min(1, t / 0.004)
      let s = 0
      for (const [ratio, amp, decay] of partials) s += amp * Math.exp(-t / (decay * 0.5)) * Math.sin(TAU * f0 * ratio * t)
      s *= attack * 0.3
      L[i] += s * (1 - pan)
      R[i] += s * pan
    }
  }
  return normalize(reverb([L, R], { room: 0.86, damp: 0.25, wet: 0.5 }), 0.6)
}

function whoosh() {
  const dur = 1.8, n = Math.round(dur * SR)
  const noise = new Float32Array(n).map(() => rand())
  const sweep = (i) => {
    const p = i / n
    return 380 + 2300 * Math.sin(Math.PI * Math.min(1, p * 1.25)) ** 2
  }
  const band = biquadBandpass(noise, sweep, 1.1)
  const L = new Float32Array(n), R = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const p = i / n
    const env = Math.sin(Math.PI * Math.pow(p, 0.7)) ** 2
    L[i] = band[i] * env * (1 - p * 0.7)
    R[i] = band[i] * env * (0.3 + p * 0.7)
  }
  return normalize(reverb([L, R], { room: 0.8, damp: 0.5, wet: 0.3 }), 0.5)
}

function tick() {
  const n = Math.round(0.35 * SR)
  const L = new Float32Array(n), R = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / SR
    const s = Math.exp(-t / 0.018) * (Math.sin(TAU * 2350 * t) * 0.6 + Math.sin(TAU * 3920 * t) * 0.25)
    L[i] = s
    R[i] = s
  }
  return normalize(reverb([L, R], { room: 0.7, damp: 0.5, wet: 0.25 }), 0.35)
}

console.log('audio')
await encode('ambient', ambient(), 96)
await encode('chime', chime(), 64)
await encode('whoosh', whoosh(), 64)
await encode('tick', tick(), 48)
