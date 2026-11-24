/**
 * Voice note-taker e2e. Chromium's microphone is replaced by a recorded clip
 * (tests/fixtures/meeting.wav — a participant stating an idea, a decision, an
 * action for "Ben", an open question, then asking Scout to group the board).
 *
 * This makes real transcription, model and Scout calls billed to the app
 * owner (about two cents), so it is tagged @voice and @scout.
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
      // %noloop: play the clip once, then silence.
      `--use-file-for-fake-audio-capture=${clip}%noloop`,
    ],
  },
})

test.skip(loadAllTestAccounts().length < 2, 'Needs 2 test accounts (npx deepspace test accounts create …)')

test('spoken points become typed notes for everyone, and "Scout, …" runs Scout @voice @scout', async ({
  users,
}) => {
  test.setTimeout(240_000)
  const [speaker, listener] = await users(2)

  await speaker.page.goto('/home')
  await speaker.page.getByTestId('new-board').click()
  await speaker.page.waitForURL(/\/b\/[^/]+$/, { timeout: 20_000 })
  await listener.page.goto(new URL(speaker.page.url()).pathname)
  await expect(listener.page.getByTestId('board-surface')).toBeVisible({ timeout: 20_000 })

  await speaker.page.getByTestId('notetaker-start').click()
  await expect(speaker.page.getByTestId('notetaker-live')).toBeVisible({ timeout: 30_000 })

  // The other person, who is not listening to anything, sees the notes land.
  const heard = listener.page.locator('[data-testid="note"][data-author="voice"]')
  await expect.poll(() => heard.count(), { timeout: 90_000 }).toBeGreaterThanOrEqual(3)

  // The clip contains one clear decision and one clear action item.
  await expect(listener.page.locator('[data-testid="note"][data-kind="decision"]')).not.toHaveCount(0)
  await expect(listener.page.locator('[data-testid="note"][data-kind="action"]')).toContainText(/Ben/)

  // "Scout, please group the notes…" was spoken, not typed.
  await expect
    .poll(() => listener.page.getByTestId('cluster-frame').count(), { timeout: 120_000 })
    .toBeGreaterThan(0)

  // Notes must not overlap each other when they arrive one at a time.
  const transforms = await heard.evaluateAll((els) => els.map((el) => (el as HTMLElement).style.transform))
  expect(new Set(transforms).size).toBe(transforms.length)

  await speaker.page.getByTestId('notetaker-stop').click()
  await expect(speaker.page.getByTestId('notetaker-start')).toBeVisible()
})
