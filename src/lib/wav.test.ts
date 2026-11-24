import { describe, expect, it } from 'vitest'
import { encodeWav, rms, toBase64 } from './wav'

describe('encodeWav', () => {
  const wav = encodeWav([new Float32Array([0, 1, -1]), new Float32Array([0.5, 2])], 16000)
  const view = new DataView(wav.buffer)
  const text = (offset: number) => String.fromCharCode(...wav.subarray(offset, offset + 4))

  it('writes a valid header with real sizes', () => {
    expect(text(0)).toBe('RIFF')
    expect(text(8)).toBe('WAVE')
    expect(text(36)).toBe('data')
    expect(wav.length).toBe(44 + 5 * 2)
    expect(view.getUint32(4, true)).toBe(wav.length - 8)
    expect(view.getUint32(40, true)).toBe(10)
    expect(view.getUint32(24, true)).toBe(16000)
    expect(view.getUint16(22, true)).toBe(1)
  })

  it('converts samples to 16-bit PCM and clamps out-of-range input', () => {
    const samples = [0, 1, 2, 3, 4].map((i) => view.getInt16(44 + i * 2, true))
    expect(samples).toEqual([0, 32767, -32768, 16383, 32767])
  })
})

describe('rms', () => {
  it('is 0 for silence and for no samples', () => {
    expect(rms(new Float32Array(8))).toBe(0)
    expect(rms(new Float32Array(0))).toBe(0)
  })
  it('is the amplitude of a constant signal', () => {
    expect(rms(new Float32Array([0.5, -0.5, 0.5, -0.5]))).toBeCloseTo(0.5)
  })
})

describe('toBase64', () => {
  it('round-trips bytes across the chunk boundary', () => {
    const bytes = new Uint8Array(0x8000 + 3).map((_, i) => i % 251)
    const decoded = Uint8Array.from(atob(toBase64(bytes)), (ch) => ch.charCodeAt(0))
    expect(decoded).toEqual(bytes)
  })
})
