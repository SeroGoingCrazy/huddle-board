/**
 * Audio worklet for the voice note-taker: forwards raw microphone samples
 * (mono Float32) to the page, which cuts them into utterances and encodes
 * WAV. Served as a static file because worklets load from a URL.
 */
class HuddleTap extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0]
    // Copy: the engine reuses the underlying buffer on the next call.
    if (channel) this.port.postMessage(channel.slice(0))
    return true
  }
}
registerProcessor('huddle-tap', HuddleTap)
