/**
 * Utterance segmentation: decides, from microphone loudness alone, when a
 * stretch of recording should be cut and whether it is worth sending.
 *
 * Pure state machine — no audio APIs — so it can be unit-tested with a list
 * of loudness samples. NoteTaker.tsx feeds it one sample per tick and acts on
 * the result by stopping and restarting its MediaRecorder.
 *
 * The goal is to send whole thoughts: cut at a pause, never mid-sentence if
 * avoidable, and never pay to transcribe silence.
 */

export interface SegmenterConfig {
  /** RMS level above which a tick counts as speech (0..1). */
  speechLevel: number
  /** Speech needed before a segment is considered to contain anything. */
  minSpeechMs: number
  /** Pause after speech that ends an utterance. */
  pauseMs: number
  /** Do not cut segments shorter than this, even at a pause. */
  minSegmentMs: number
  /** Cut anyway at this length, pause or not, so latency stays bounded. */
  maxSegmentMs: number
  /** Throw away a segment that has stayed silent this long. */
  silentDiscardMs: number
}

export const DEFAULT_SEGMENTER: SegmenterConfig = {
  speechLevel: 0.015,
  minSpeechMs: 300,
  pauseMs: 900,
  minSegmentMs: 1500,
  maxSegmentMs: 20_000,
  silentDiscardMs: 8000,
}

/** `send`: cut and transcribe. `discard`: cut and drop. `continue`: keep recording. */
export type SegmentDecision = 'continue' | 'send' | 'discard'

export interface Segmenter {
  /** Feed one loudness sample covering `tickMs` of audio. */
  tick(level: number, tickMs: number): SegmentDecision
  /** Whether the segment in progress contains speech (used when stopping). */
  hasSpeech(): boolean
  /** Start a fresh segment (call after acting on a cut). */
  reset(): void
}

export function createSegmenter(config: SegmenterConfig = DEFAULT_SEGMENTER): Segmenter {
  let segmentMs = 0
  let speechMs = 0
  let silenceMs = 0

  const reset = () => {
    segmentMs = 0
    speechMs = 0
    silenceMs = 0
  }
  const hasSpeech = () => speechMs >= config.minSpeechMs

  return {
    reset,
    hasSpeech,
    tick(level, tickMs) {
      segmentMs += tickMs
      if (level >= config.speechLevel) {
        speechMs += tickMs
        silenceMs = 0
      } else {
        silenceMs += tickMs
      }

      if (hasSpeech()) {
        if (silenceMs >= config.pauseMs && segmentMs >= config.minSegmentMs) return 'send'
        if (segmentMs >= config.maxSegmentMs) return 'send'
        return 'continue'
      }
      return segmentMs >= config.silentDiscardMs ? 'discard' : 'continue'
    },
  }
}
