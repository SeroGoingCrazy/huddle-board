import { resolveAppRole } from 'deepspace/worker'
import type { ActionHandler } from 'deepspace/worker'
import type { Env } from '../../worker'

/** Collections whose rows belong to a board and must go when it does. */
const BOARD_CHILDREN = ['notes', 'clusters', 'agents'] as const
const PAGE = 500

export const actions: Record<string, ActionHandler<Env>> = {
  /**
   * Delete a board and everything on it.
   *
   * A server action because a member's own permissions cannot do this: the
   * notes on a board were written by many people (and by Scout on their
   * behalf). Action tools run with RBAC OFF, so the ownership check below is
   * the only authorization there is — it must stay.
   */
  deleteBoard: async ({ userId, params, tools, env }) => {
    const boardId = typeof params.boardId === 'string' ? params.boardId : ''
    if (!boardId) return { success: false, error: 'boardId is required' }

    const found = await tools.get('boards', boardId)
    const board = found.success ? (found.data as { record?: { createdBy?: string } }).record : undefined
    if (!board) return { success: false, error: 'Board not found' }
    if (board.createdBy !== userId && (await resolveAppRole(env, userId)) !== 'admin') {
      return { success: false, error: 'Only the person who created a board can delete it.' }
    }

    for (const collection of BOARD_CHILDREN) {
      // deleteWhere removes one bounded page per call; repeat until drained.
      for (;;) {
        const page = await tools.deleteWhere(collection, { boardId }, PAGE)
        if (!page.success) return { success: false, error: `Could not clear ${collection}: ${page.error}` }
        if ((page.data?.deleted ?? 0) < PAGE) break
      }
    }
    return tools.remove('boards', boardId)
  },
}
