/**
 * Regenerates tests/fixtures/meeting.wav — the "participant" the voice
 * note-taker test listens to. Costs a fraction of a cent of TTS.
 *
 *   npx deepspace integrations invoke speech/text-to-speech -y --json \
 *     -f tests/fixtures/meeting.tts.json | node tests/fixtures/make-meeting-audio.mjs
 *
 * The provider streams WAV with a placeholder length in its header, which
 * Chromium's fake-microphone reader rejects, so this rewrites the header and
 * appends silence (the model needs a pause to treat the last sentence as done).
 */
import { writeFileSync } from 'node:fs'

let raw = ''
for await (const chunk of process.stdin) raw += chunk
const dataUri = raw.match(/data:audio\/[a-z0-9.+-]+;base64,([A-Za-z0-9+/=]+)/i)
if (!dataUri) throw new Error('No audio data URI in the integration response')
const wav = Buffer.from(dataUri[1], 'base64')

const dataAt = wav.indexOf('data', 12, 'ascii')
if (wav.toString('ascii', 0, 4) !== 'RIFF' || dataAt < 0) throw new Error('Not a WAV file')
const sampleRate = wav.readUInt32LE(24)
const blockAlign = wav.readUInt16LE(32)
const pcm = wav.subarray(dataAt + 8)
const silence = Buffer.alloc(sampleRate * blockAlign * 4)
const body = Buffer.concat([pcm, silence])
const header = Buffer.from(wav.subarray(0, dataAt + 8))
header.writeUInt32LE(header.length - 8 + body.length, 4)
header.writeUInt32LE(body.length, dataAt + 4)
writeFileSync(new URL('./meeting.wav', import.meta.url), Buffer.concat([header, body]))
console.log(`meeting.wav: ${(body.length / (sampleRate * blockAlign)).toFixed(1)}s at ${sampleRate} Hz`)
