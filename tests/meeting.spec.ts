/**
 * Meeting e2e: two signed-in people join the board's voice call.
 *
 * Chromium's microphone is replaced by tests/fixtures/meeting.wav, so "Ada
 * talks" is that recorded clip. Ben mutes on joining, which makes Ada the
 * only source of sound: anything heard, transcribed or noted must be hers.
 *
 * Opens a real LiveKit room (free) and makes real transcription and model
 * calls (a few cents, billed to the app owner unless run with
 * --secrets-config dev), so it is tagged @voice and @call.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect, loadAllTestAccounts, chromiumLaunchOptions } from 'deepspace/testing'

const clip = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'meeting.wav')

test.use({
  launchOptions: {
    ...chromiumLaunchOptions(),
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${clip}%noloop`,
    ],
  },
})

test.skip(loadAllTestAccounts().length < 2, 'Needs 2 test accounts (npx deepspace test accounts create …)')

test('two people in a meeting: the call connects, speech is attributed, notes appear @voice @call', async ({
  users,
}) => {
  test.setTimeout(240_000)
  const [ada, ben] = await users(2)

  await ada.page.goto('/home')
  await ada.page.getByTestId('new-board').click()
  await ada.page.waitForURL(/\/b\/[^/]+$/, { timeout: 20_000 })
  await ben.page.goto(new URL(ada.page.url()).pathname)
  await expect(ben.page.getByTestId('board-surface')).toBeVisible({ timeout: 20_000 })

  // Ben joins first and mutes, so only Ada's microphone (the clip) is heard.
  await ben.page.getByTestId('join-meeting').click()
  await expect(ben.page.getByTestId('meeting-bar')).toBeVisible({ timeout: 30_000 })
  await ben.page.getByTestId('toggle-mic').click()
  await expect(ben.page.getByTestId('toggle-mic')).toHaveAttribute('aria-pressed', 'true')

  await ada.page.getByTestId('join-meeting').click()
  await expect(ada.page.getByTestId('meeting-bar')).toBeVisible({ timeout: 30_000 })

  // Both see both people in the call.
  for (const page of [ada.page, ben.page]) {
    await expect(page.getByTestId('call-count')).toHaveText('2 in meeting', { timeout: 20_000 })
  }
  // Ben receives Ada's audio track, and the call reports someone speaking:
  // sound actually travelled from one browser to the other.
  await expect(ben.page.locator('[data-testid="call-audio"] audio')).toHaveCount(1, { timeout: 20_000 })
  await expect(ben.page.locator('[data-testid="call-participant"][data-speaking="true"]')).not.toHaveCount(0, {
    timeout: 30_000,
  })

  // Joining the meeting started Ada's note-taker without a second click.
  await expect(ada.page.getByTestId('notetaker-live')).toBeVisible()
  const heard = ben.page.locator('[data-testid="note"][data-author="voice"]')
  await expect.poll(() => heard.count(), { timeout: 90_000 }).toBeGreaterThanOrEqual(3)

  // The notes name the person whose microphone produced them.
  await expect(heard.first()).toContainText(`${ada.name} said`)

  // Ben, muted, reads what Ada said under Ada's name; nothing is attributed to him.
  await ben.page.getByTestId('tab-transcript').click()
  await expect(ben.page.getByTestId('transcript-line').first()).toContainText(ada.name, { timeout: 30_000 })
  await expect(ben.page.getByTestId('transcript')).toContainText(/dark mode/i)
  const speakers = await ben.page.getByTestId('transcript-speaker').allTextContents()
  expect(new Set(speakers)).toEqual(new Set([ada.name]))

  // Leaving ends the call for that person and stops their note-taker.
  await ada.page.getByTestId('leave-meeting').click()
  await expect(ada.page.getByTestId('join-meeting')).toBeVisible()
  await expect(ada.page.getByTestId('notetaker-live')).toHaveCount(0)
  await expect(ben.page.getByTestId('call-count')).toHaveText('1 in meeting', { timeout: 20_000 })
})
