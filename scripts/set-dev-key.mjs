/**
 * Stores your own Anthropic API key as DEV_ANTHROPIC_API_KEY in the app's
 * `dev` secrets config, so local development uses your key instead of
 * DeepSpace credits (see src/ai/model.ts).
 *
 *   node scripts/set-dev-key.mjs
 *
 * The key is read with echo off and piped straight to the DeepSpace CLI: it
 * is never printed, never an argument (so not in shell history or `ps`), and
 * never written to a file in this repo.
 */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const cli = fileURLToPath(new URL('../node_modules/deepspace/dist/cli.js', import.meta.url))

function readHidden(prompt) {
  return new Promise((resolve, reject) => {
    const { stdin, stdout } = process
    if (!stdin.isTTY) return reject(new Error('Run this in an interactive terminal.'))
    stdout.write(prompt)
    stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding('utf8')
    let value = ''
    const done = (fn, arg) => {
      stdin.setRawMode(false)
      stdin.pause()
      stdin.removeListener('data', onData)
      stdout.write('\n')
      fn(arg)
    }
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') return done(resolve, value)
        if (ch === '\u0003') return done(reject, new Error('Cancelled.'))
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1)
        else if (ch >= ' ') value += ch
      }
    }
    stdin.on('data', onData)
  })
}

try {
  const key = (await readHidden('Paste your Anthropic API key (input is hidden), then press Enter: ')).trim()
  if (!key) throw new Error('Nothing entered; nothing was changed.')

  const child = spawn(process.execPath, [cli, 'secrets', 'set', 'DEV_ANTHROPIC_API_KEY', '--stdin', '-c', 'dev'], {
    stdio: ['pipe', 'inherit', 'inherit'],
  })
  child.stdin.end(key)
  const code = await new Promise((resolve) => child.on('close', resolve))
  if (code !== 0) throw new Error(`deepspace secrets set exited with code ${code}`)
  console.log('Saved to the "dev" secrets config. Restart the dev server with --secrets-config dev.')
} catch (err) {
  console.error(err.message)
  process.exitCode = 1
}
