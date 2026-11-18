import type { OrcaRuntimeService } from '../runtime/orca-runtime'

export type VoiceFocusParams = {
  target: 'terminal' | 'file' | 'diff' | 'browser' | 'workspace'
  query?: string
  url?: string
  direction?: 'next' | 'prev'
}

export async function focusVoiceTarget(
  runtime: OrcaRuntimeService,
  worktreeSelector: string,
  args: VoiceFocusParams,
  state: { lastBrowserFocusIndex: number }
): Promise<{ ok: boolean; detail: string }> {
  const q = (args.query || '').trim()
  try {
    if (args.target === 'workspace') {
      let targetId = worktreeSelector
      if (q) {
        const list = await runtime.listManagedWorktrees(undefined, 100)
        const match = list.worktrees.find(
          (w) =>
            w.id === q ||
            w.path.toLowerCase().includes(q.toLowerCase()) ||
            w.branch.toLowerCase().includes(q.toLowerCase())
        )
        if (match) {
          targetId = match.id
        }
      }
      await runtime.activateManagedWorktree(targetId, { notifyClients: true })
      return { ok: true, detail: `Focused workspace ${targetId}` }
    }

    if (args.target === 'terminal') {
      const list = await runtime.listTerminals(worktreeSelector)
      const match =
        (q
          ? list.terminals.find(
              (t) =>
                t.title?.toLowerCase().includes(q.toLowerCase()) ||
                t.handle.toLowerCase().includes(q.toLowerCase())
            )
          : list.terminals.find((t) => t.title?.includes('Dev| Oncall'))) ?? list.terminals[0]
      if (!match) {
        return { ok: false, detail: 'No matching terminal found in worktree' }
      }
      await runtime.focusTerminal(match.handle, { navigateHost: true })
      return { ok: true, detail: `Focused terminal ${match.title || match.handle}` }
    }

    if (args.target === 'file') {
      const rel = q || 'README.md'
      await runtime.openMobileFile(worktreeSelector, rel)
      return { ok: true, detail: `Opened file ${rel}` }
    }

    if (args.target === 'diff') {
      const rel = q || ''
      if (rel) {
        await runtime.openMobileDiff(worktreeSelector, rel, false)
        return { ok: true, detail: `Opened diff for ${rel}` }
      }
      await runtime.activateManagedWorktree(worktreeSelector, { notifyClients: true })
      return { ok: true, detail: 'Focused worktree for diff inspection' }
    }

    if (args.target === 'browser') {
      if (args.url) {
        await runtime.browserTabCreate({
          url: args.url,
          worktree: worktreeSelector
        })
        const afterCreate = (await runtime.browserTabList({
          worktree: worktreeSelector
        })) as { tabs?: { index?: number }[] }
        const createdTab = afterCreate?.tabs?.at(-1)
        if (typeof createdTab?.index === 'number') {
          await runtime.browserTabSwitch({
            index: createdTab.index,
            worktree: worktreeSelector,
            focus: true
          })
        }
        return { ok: true, detail: `Opened browser tab ${args.url}` }
      }
      const tabListRes = (await runtime.browserTabList({
        worktree: worktreeSelector
      })) as { tabs?: { index?: number; url?: string; title?: string; active?: boolean }[] }
      const tabs = Array.isArray(tabListRes?.tabs) ? tabListRes.tabs : []
      if (tabs.length === 0) {
        return { ok: false, detail: 'No browser tabs open in worktree' }
      }
      const activeIdx = tabs.findIndex((t) => t.active)
      const baseIdx = activeIdx !== -1 ? activeIdx : Math.max(0, state.lastBrowserFocusIndex)
      const delta = args.direction === 'prev' ? -1 : 1
      const nextPos = (baseIdx + delta + tabs.length) % tabs.length
      const targetTab = tabs[nextPos]
      const switchIndex = typeof targetTab?.index === 'number' ? targetTab.index : nextPos
      state.lastBrowserFocusIndex = nextPos
      await runtime.browserTabSwitch({
        index: switchIndex,
        worktree: worktreeSelector,
        focus: true
      })
      return {
        ok: true,
        detail: `Focused browser tab ${targetTab?.title || targetTab?.url || `#${switchIndex}`}`
      }
    }

    return { ok: false, detail: `Unsupported focus target: ${String(args.target)}` }
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) }
  }
}
