/**
 * Board e2e — two signed-in users on one board.
 *
 * The first test covers the human path (records sync + presence). The second
 * drives Scout end to end and therefore spends real model/search credits on
 * the app owner's account. It is tagged @scout; to run only the free test:
 *   npx deepspace test run e2e --grep "sync between"
 */
import { test, expect, loadAllTestAccounts } from 'deepspace/testing'
import type { Page } from '@playwright/test'

test.skip(loadAllTestAccounts().length < 2, 'Needs 2 test accounts (npx deepspace test accounts create …)')

/** User A creates a board from /home and both users end up on it. */
async function openSharedBoard(a: Page, b: Page): Promise<void> {
  await a.goto('/home')
  await a.getByTestId('new-board').click()
  await a.waitForURL(/\/b\/[^/]+$/, { timeout: 20_000 })
  await expect(a.getByTestId('board-surface')).toBeVisible({ timeout: 20_000 })
  await b.goto(new URL(a.url()).pathname)
  await expect(b.getByTestId('board-surface')).toBeVisible({ timeout: 20_000 })
}

const transformOf = (page: Page) =>
  page.getByTestId('note').first().evaluate((el) => (el as HTMLElement).style.transform)

test('notes, moves and cursors sync between two users', async ({ users }) => {
  const [a, b] = await users(2)
  await openSharedBoard(a.page, b.page)

  // A writes a note; B sees it.
  await a.page.getByTestId('add-note').click()
  await a.page.locator('[data-testid="note"] textarea').fill('Ship the onboarding checklist')
  await a.page.keyboard.press('Enter')
  await expect(b.page.getByTestId('note')).toHaveText(/Ship the onboarding checklist/, { timeout: 10_000 })

  // A drags it; B sees it land somewhere else.
  const before = await transformOf(b.page)
  const box = (await a.page.getByTestId('note').first().boundingBox())!
  await a.page.mouse.move(box.x + 20, box.y + 20)
  await a.page.mouse.down()
  await a.page.mouse.move(box.x + 180, box.y + 140, { steps: 8 })
  await a.page.mouse.up()
  await expect.poll(() => transformOf(b.page), { timeout: 10_000 }).not.toBe(before)
  // …and A's own copy settles on the same spot (no snap-back after the echo).
  // Compare both live on every poll: B may still be receiving A's last write.
  await expect
    .poll(async () => (await transformOf(a.page)) === (await transformOf(b.page)), { timeout: 10_000 })
    .toBe(true)

  // B moves the pointer over the board; A sees B's cursor.
  const surface = (await b.page.getByTestId('board-surface').boundingBox())!
  await b.page.mouse.move(surface.x + 200, surface.y + 200)
  await b.page.mouse.move(surface.x + 260, surface.y + 240, { steps: 4 })
  await expect(a.page.getByTestId('peer-cursor')).toHaveCount(1, { timeout: 10_000 })

  // B deletes the note; it disappears for A.
  await b.page.getByTestId('note').first().click()
  await b.page.getByRole('button', { name: 'Delete note' }).click()
  await expect(a.page.getByTestId('note')).toHaveCount(0, { timeout: 10_000 })
})

test('Scout adds, groups and summarizes for everyone @scout', async ({ users }) => {
  test.setTimeout(300_000)
  const [a, b] = await users(2)
  await openSharedBoard(a.page, b.page)

  const ask = async (prompt: string) => {
    await a.page.getByTestId('scout-input').fill(prompt)
    await a.page.getByTestId('scout-send').click()
    // The input locks for the length of the run and unlocks when it ends.
    await expect(a.page.getByTestId('scout-input')).toBeDisabled()
    await expect(a.page.getByTestId('scout-input')).toBeEnabled({ timeout: 120_000 })
    await expect(a.page.getByTestId('scout-cursor')).toHaveCount(0)
  }

  // B, who did not ask, sees Scout's notes arrive.
  await ask('Add exactly 6 short notes with ideas for making remote standups better.')
  const agentNotes = b.page.locator('[data-testid="note"][data-author="agent"]')
  await expect(agentNotes).toHaveCount(6, { timeout: 15_000 })
  await expect(b.page.getByTestId('scout-status')).not.toHaveText('', { timeout: 10_000 })

  await ask('Group the notes into themes.')
  await expect.poll(() => b.page.getByTestId('cluster-frame').count(), { timeout: 15_000 }).toBeGreaterThan(1)
  // Grouping must not lose or duplicate notes.
  await expect(b.page.getByTestId('note')).toHaveCount(6)

  await ask('Write the summary.')
  await expect(b.page.getByTestId('summary')).not.toHaveValue('', { timeout: 15_000 })
})

test('sample meeting board opens populated, and deleting a board removes it', async ({ users }) => {
  const [a] = await users(1)
  await a.page.goto('/home')
  await a.page.getByTestId('sample-board').click()
  await a.page.waitForURL(/\/b\/[^/]+$/, { timeout: 20_000 })
  const boardPath = new URL(a.page.url()).pathname

  // Every note kind is present, with an owner on the action items.
  await expect(a.page.getByTestId('note')).toHaveCount(10, { timeout: 15_000 })
  for (const kind of ['idea', 'decision', 'action', 'question']) {
    await expect(a.page.locator(`[data-testid="note"][data-kind="${kind}"]`)).not.toHaveCount(0)
  }
  await expect(a.page.locator('[data-testid="note"][data-kind="action"]').first()).toContainText(/Maya|Leo/)

  // Delete it from the list (the confirm dialog is accepted).
  await a.page.goto('/home')
  const card = a.page.locator('li', { hasText: 'Sample: onboarding redesign sync' }).first()
  await expect(card).toBeVisible({ timeout: 15_000 })
  const before = await a.page.locator('li', { hasText: 'Sample: onboarding redesign sync' }).count()
  a.page.once('dialog', (dialog) => void dialog.accept())
  await card.hover()
  await card.getByRole('button', { name: /^Delete / }).click()
  await expect(a.page.locator('li', { hasText: 'Sample: onboarding redesign sync' })).toHaveCount(before - 1, {
    timeout: 15_000,
  })
  await a.page.goto(boardPath)
  await expect(a.page.getByText('This board does not exist')).toBeVisible({ timeout: 15_000 })
})

test('action items form a shared checklist, and minutes are refused without a deliverable address', async ({
  users,
}) => {
  const [a, b] = await users(2)
  await a.page.goto('/home')
  await a.page.getByTestId('sample-board').click()
  await a.page.waitForURL(/\/b\/[^/]+$/, { timeout: 20_000 })
  await b.page.goto(new URL(a.page.url()).pathname)
  await expect(b.page.getByTestId('note')).toHaveCount(10, { timeout: 20_000 })

  // The sample has two action items; the tab counts the open ones.
  await a.page.getByTestId('tab-actions').click()
  await expect(a.page.getByTestId('action-item')).toHaveCount(2)
  await expect(a.page.getByTestId('tab-actions')).toHaveText('Actions (2)')

  // A ticks one off: B's board strikes that note through, and B's tab recounts.
  // click(), not check(): a completed item moves to the end of the list, so
  // the "first" item is a different one by the time check() re-reads it.
  await a.page.getByTestId('action-item').first().getByRole('checkbox').click()
  await expect(a.page.getByRole('checkbox', { checked: true })).toHaveCount(1)
  await expect(b.page.locator('[data-testid="note"][data-done="true"]')).toHaveCount(1, { timeout: 10_000 })
  await expect(b.page.getByTestId('tab-actions')).toHaveText('Actions (1)', { timeout: 10_000 })

  // A reassigns the remaining item by hand; B's note shows the new owner.
  const open = a.page.getByTestId('action-item').first()
  await open.getByLabel('Owner').fill('Priya')
  await open.getByLabel('Owner').press('Enter')
  await expect(b.page.locator('[data-testid="note"][data-done="false"][data-kind="action"]')).toContainText(
    'Priya',
    { timeout: 10_000 },
  )

  // Test accounts have undeliverable addresses, so nothing is sent (or billed).
  await a.page.getByTestId('tab-summary').click()
  await a.page.getByTestId('email-minutes').click()
  await expect(a.page.getByText('No deliverable email address')).toBeVisible({ timeout: 15_000 })
})
