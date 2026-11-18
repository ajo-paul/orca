import fs from 'node:fs'
import path from 'node:path'
import WebSocket from 'ws'
import { TUI_AGENT_CONFIG } from '../../shared/agent-launch/catalog/tui-agent-config'
import type { TuiAgent } from '../../shared/agent-launch/catalog/tui-agent'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import type { PiTerminalWorker } from './pi-terminal-worker'
import type { VoiceFocusParams } from './voice-focus-controller'
import { getGitStatusSummary, readWorkspaceTodos } from './voice-workspace-helpers'

export type VoiceMode = 'Scout' | 'Ship' | 'Review' | 'Pocket'
export const VALID_MODES = new Set<VoiceMode>(['Scout', 'Ship', 'Review', 'Pocket'])

function readWorkspaceFileChunk(
  workspacePath: string,
  requestedPath: string,
  offset: number,
  limit: number
): Record<string, unknown> {
  const wsRoot = path.resolve(workspacePath)
  let candidate = path.resolve(wsRoot, requestedPath)
  if (!candidate.startsWith(wsRoot + path.sep) && candidate !== wsRoot) {
    return { error: 'Access denied: path outside workspace.' }
  }
  if (!fs.existsSync(candidate) && requestedPath.toLowerCase() === 'readme.md') {
    const found = fs
      .readdirSync(wsRoot)
      .find((f) => f.toLowerCase() === 'readme.md' || f.toLowerCase() === 'readme')
    if (found) {
      candidate = path.join(wsRoot, found)
    }
  }
  if (!fs.existsSync(candidate) || fs.statSync(candidate).isDirectory()) {
    return { error: `File not found: ${requestedPath}` }
  }
  const fullText = fs.readFileSync(candidate, 'utf8')
  const totalChars = fullText.length
  let content = ''
  let hasMore = false
  let nextOffset: number | null = null
  if (offset < totalChars) {
    let end = Math.min(totalChars, offset + limit)
    if (end < totalChars) {
      const nl = fullText.lastIndexOf('\n', end)
      if (nl > offset + 200) {
        end = nl + 1
      }
    }
    content = fullText.slice(offset, end)
    hasMore = end < totalChars
    nextOffset = hasMore ? end : null
  }
  return { path: requestedPath, offset, totalChars, hasMore, nextOffset, content }
}

export async function executeVoiceToolCall(ctx: {
  gws: WebSocket
  fc: { id: string; name: string; args?: Record<string, unknown> }
  runtime: OrcaRuntimeService
  pi: PiTerminalWorker
  worktreeSelector: string
  workspacePath: string
  gitBranch: string
  getVoiceMode: () => VoiceMode
  setVoiceMode: (mode: VoiceMode) => void
  pushActivity: (kind: 'pi_prompt', text: string) => void
  emitPiAborted: () => void
  focusTarget: (args: VoiceFocusParams) => Promise<{ ok: boolean; detail: string }>
  endCall: (reason: string) => void
}): Promise<void> {
  const { gws, fc, runtime, pi, worktreeSelector, workspacePath, gitBranch } = ctx
  const args = fc.args ?? {}
  const respond = (output: Record<string, unknown>): void => {
    if (gws.readyState === WebSocket.OPEN) {
      gws.send(
        JSON.stringify({
          toolResponse: {
            functionResponses: [
              { id: fc.id, name: fc.name, scheduling: 'WHEN_IDLE', response: { output } }
            ]
          }
        })
      )
    }
  }

  try {
    if (fc.name === 'dispatch_to_pi') {
      const prompt = String(args.prompt || '').trim()
      if (!prompt) {
        respond({ error: 'Prompt is required' })
        return
      }
      ctx.pushActivity('pi_prompt', prompt)
      await pi.sendPrompt(prompt)
      respond({
        status: 'dispatched_and_running_in_background',
        note: 'Pi has ONLY JUST STARTED. Wait for [PI TEAM COMPLETED] before reporting results.'
      })
      return
    }
    if (fc.name === 'steer_pi') {
      const prompt = String(args.prompt || '').trim()
      if (!prompt) {
        respond({ error: 'Prompt is required' })
        return
      }
      ctx.pushActivity('pi_prompt', `(steer) ${prompt}`)
      await pi.steer(prompt)
      respond({ status: 'steered' })
      return
    }
    if (fc.name === 'abort_pi') {
      await pi.abort()
      ctx.emitPiAborted()
      respond({ status: 'aborted' })
      return
    }
    if (fc.name === 'get_pi_status') {
      respond({
        running: pi.isStreaming,
        currentTool: pi.currentTool,
        modifiedFiles: Array.from(pi.modifiedFiles),
        gitStatus: getGitStatusSummary(workspacePath)
      })
      return
    }
    if (fc.name === 'read_workspace_todos') {
      respond({
        todos: readWorkspaceTodos(workspacePath),
        gitStatus: getGitStatusSummary(workspacePath)
      })
      return
    }
    if (fc.name === 'read_workspace_file') {
      const requestedPath = String(args.path || 'README.md').trim()
      const offset = Math.max(0, Math.floor(Number(args.offset) || 0))
      const limit = Math.min(4000, Math.max(500, Math.floor(Number(args.limit) || 3500)))
      respond(readWorkspaceFileChunk(workspacePath, requestedPath, offset, limit))
      return
    }
    if (fc.name === 'set_voice_mode') {
      const requested = String(args.mode || 'Ship') as VoiceMode
      if (VALID_MODES.has(requested)) {
        ctx.setVoiceMode(requested)
      }
      respond({ voiceMode: ctx.getVoiceMode() })
      return
    }
    if (fc.name === 'end_call') {
      respond({ status: 'ending_call' })
      ctx.endCall(String(args.reason || 'Caller requested hangup'))
      return
    }
    if (fc.name === 'orca_list_worktrees') {
      const res = await runtime.listManagedWorktrees(undefined, 100)
      respond({
        worktrees: res.worktrees.map((w) => ({ id: w.id, branch: w.branch, path: w.path }))
      })
      return
    }
    if (fc.name === 'orca_focus_workspace') {
      respond(
        await ctx.focusTarget({
          target: args.showDiff ? 'diff' : 'workspace',
          query: typeof args.query === 'string' ? args.query : undefined
        })
      )
      return
    }
    if (fc.name === 'orca_focus') {
      const target = String(args.target || 'terminal') as VoiceFocusParams['target']
      respond(
        await ctx.focusTarget({
          target,
          query: typeof args.query === 'string' ? args.query : undefined,
          url: typeof args.url === 'string' ? args.url : undefined,
          direction: args.direction === 'prev' ? 'prev' : 'next'
        })
      )
      return
    }
    if (fc.name === 'orca_open_browser') {
      const url = String(args.url || '').trim()
      respond(
        url ? await ctx.focusTarget({ target: 'browser', url }) : { error: 'url is required' }
      )
      return
    }
    if (fc.name === 'orca_list_harnesses') {
      respond({
        harnesses: Object.entries(TUI_AGENT_CONFIG).map(([id, cfg]) => ({ id, cmd: cfg.detectCmd }))
      })
      return
    }
    if (fc.name === 'orca_launch_harness') {
      const harnessId = String(args.harnessId || 'pi').trim() as TuiAgent
      const created = await runtime.createTerminal(worktreeSelector, {
        startupAgent: harnessId,
        cwd: workspacePath,
        title: typeof args.title === 'string' ? args.title : `Dev| Oncall (${harnessId})`,
        presentation: 'background'
      })
      const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : ''
      if (prompt) {
        await runtime.sendTerminal(
          created.handle,
          { text: prompt, enter: true },
          { inputKind: 'driving', inputSource: 'desktop' }
        )
      }
      respond({ ok: true, handle: created.handle, harnessId })
      return
    }
    if (fc.name === 'orca_list_terminals') {
      const list = await runtime.listTerminals(worktreeSelector)
      respond({
        terminals: list.terminals.map((t) => ({
          handle: t.handle,
          title: t.title,
          ptyId: t.ptyId,
          branch: t.branch
        }))
      })
      return
    }
    if (fc.name === 'orca_read_terminal') {
      const list = await runtime.listTerminals(worktreeSelector)
      const handle =
        typeof args.terminalHandle === 'string' && args.terminalHandle.trim()
          ? args.terminalHandle.trim()
          : pi.getTerminalHandle() || list.terminals[0]?.handle || ''
      if (!handle) {
        respond({ error: 'No terminal available in worktree.' })
        return
      }
      const limit = Math.min(200, Math.max(10, Number(args.limit) || 80))
      respond({ handle, read: await runtime.readTerminal(handle, { limit }) })
      return
    }
    if (fc.name === 'orca_send_to_terminal') {
      const list = await runtime.listTerminals(worktreeSelector)
      const handle =
        typeof args.terminalHandle === 'string' && args.terminalHandle.trim()
          ? args.terminalHandle.trim()
          : list.terminals[0]?.handle || ''
      const text = String(args.text || '')
      if (!handle || !text) {
        respond({ error: 'terminalHandle and text are required' })
        return
      }
      await runtime.sendTerminal(
        handle,
        { text, enter: args.pressEnter !== false },
        { inputKind: 'driving', inputSource: 'desktop' }
      )
      respond({ ok: true, handle, gitBranch })
      return
    }
    respond({ error: `Unknown tool: ${fc.name}` })
  } catch (err) {
    respond({ error: err instanceof Error ? err.message : String(err) })
  }
}
