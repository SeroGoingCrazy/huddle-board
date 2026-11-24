import { describe, expect, it } from 'vitest'
import { DEFAULT_SEGMENTER, createSegmenter, type SegmentDecision } from './utterances'

const TICK = 100
const LOUD = 0.1
const QUIET = 0.001

/** Feed `ms` of constant loudness; return the first non-continue decision. */
function feed(seg: ReturnType<typeof createSegmenter>, level: number, ms: number): SegmentDecision {
  for (let t = 0; t < ms; t += TICK) {
    const decision = seg.tick(level, TICK)
    if (decision !== 'continue') return decision
  }
  return 'continue'
}

describe('utterance segmenter', () => {
  it('sends an utterance once the speaker pauses', () => {
    const seg = createSegmenter()
    expect(feed(seg, LOUD, 3000)).toBe('continue')
    expect(feed(seg, QUIET, DEFAULT_SEGMENTER.pauseMs)).toBe('send')
  })

  it('does not cut on a pause shorter than the threshold', () => {
    const seg = createSegmenter()
    feed(seg, LOUD, 2000)
    expect(feed(seg, QUIET, DEFAULT_SEGMENTER.pauseMs - TICK)).toBe('continue')
    expect(feed(seg, LOUD, 1000)).toBe('continue')
  })

  it('discards pure silence instead of paying to transcribe it', () => {
    const seg = createSegmenter()
    expect(feed(seg, QUIET, DEFAULT_SEGMENTER.silentDiscardMs)).toBe('discard')
  })

  it('ignores a blip too short to be speech', () => {
    const seg = createSegmenter()
    feed(seg, LOUD, DEFAULT_SEGMENTER.minSpeechMs - TICK)
    expect(seg.hasSpeech()).toBe(false)
    expect(feed(seg, QUIET, DEFAULT_SEGMENTER.silentDiscardMs)).toBe('discard')
  })

  it('cuts a monologue at the maximum length so latency stays bounded', () => {
    const seg = createSegmenter()
    expect(feed(seg, LOUD, DEFAULT_SEGMENTER.maxSegmentMs - TICK)).toBe('continue')
    expect(seg.tick(LOUD, TICK)).toBe('send')
  })

  it('waits for the minimum length before cutting a very short remark', () => {
    const seg = createSegmenter({ ...DEFAULT_SEGMENTER, minSegmentMs: 3000 })
    feed(seg, LOUD, 500)
    expect(feed(seg, QUIET, 2400)).toBe('continue')
    expect(seg.tick(QUIET, TICK)).toBe('send')
  })

  it('starts clean after reset', () => {
    const seg = createSegmenter()
    feed(seg, LOUD, 2000)
    seg.reset()
    expect(seg.hasSpeech()).toBe(false)
    expect(feed(seg, QUIET, DEFAULT_SEGMENTER.silentDiscardMs)).toBe('discard')
  })
})
