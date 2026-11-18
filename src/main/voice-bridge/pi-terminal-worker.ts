import crypto from 'node:crypto'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { PI_VOICE_EXTENSION_SOURCE } from './pi-voice-extension-source'

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

function ensureExtensionFile(): string {
  const extPath = path.join(os.tmpdir(), 'orca-pi-voice-ext.mjs')
  fs.writeFileSync(extPath, PI_VOICE_EXTENSION_SOURCE, { mode: 0o644 })
  return extPath
}

function resolvePiBin(): string {
  const candidates = [process.env.PI_BIN || '', '/opt/homebrew/bin/pi', '/usr/local/bin/pi'].filter(
    Boolean
  )
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }
  return 'pi'
}

export class PiTerminalWorker extends EventEmitter {
  private readonly runtime: OrcaRuntimeService
  private readonly worktreeSelector: string
  public readonly cwd: string
  private readonly getGeminiApiKey: () => string

  private terminalHandle: string | null = null
  private sock: net.Socket | null = null
  private sockPath = path.join(os.tmpdir(), `orca-pvb-${crypto.randomUUID().slice(0, 10)}.sock`)
  private stdoutBuf = ''
  private startingPromise: Promise<void> | null = null
  private pending = new Map<
    string,
    { resolve: (val: Record<string, unknown>) => void; reject: (err: Error) => void }
  >()
  private currentRunEmittedEnd = true

  public isStreaming = false
  public currentTool: string | null = null
  public modifiedFiles = new Set<string>()
  public lastAssistantText = ''
  public sessionFile = ''
  public sessionId = ''

  constructor(opts: {
    runtime: OrcaRuntimeService
    worktreeSelector: string
    cwd: string
    getGeminiApiKey: () => string
  }) {
    super()
    this.runtime = opts.runtime
    this.worktreeSelector = opts.worktreeSelector
    this.cwd = opts.cwd
    this.getGeminiApiKey = opts.getGeminiApiKey
  }

  async start(): Promise<void> {
    if (this.terminalHandle && this.sock && !this.sock.destroyed) {
      return
    }
    if (this.startingPromise) {
      return this.startingPromise
    }
    this.startingPromise = this.doStart().finally(() => {
      this.startingPromise = null
    })
    return this.startingPromise
  }

  private async doStart(): Promise<void> {
    if (this.sock) {
      try {
        this.sock.removeAllListeners()
        this.sock.destroy()
      } catch {}
      this.sock = null
    }
    try {
      fs.rmSync(this.sockPath, { force: true })
    } catch {}

    try {
      const existing = await this.runtime.listTerminals(this.worktreeSelector)
      for (const term of existing.terminals) {
        if (term.title?.includes('Dev| Oncall')) {
          await this.runtime.closeTerminal(term.handle).catch(() => {})
        }
      }
    } catch {}

    const extPath = ensureExtensionFile()
    const piBin = resolvePiBin()
    const key = this.getGeminiApiKey().trim()
    const envPairs = [
      'env',
      '-u',
      'NODE_OPTIONS',
      'TERM=xterm-256color',
      'COLORTERM=truecolor',
      `PI_VOICE_SOCK=${shellQuote(this.sockPath)}`
    ]
    if (key) {
      envPairs.push(
        `GEMINI_API_KEY=${shellQuote(key)}`,
        `GOOGLE_API_KEY=${shellQuote(key)}`,
        `LIVE_GEMINI_API_KEY=${shellQuote(key)}`
      )
    }

    const command = `${envPairs.join(' ')} ${shellQuote(piBin)} --extension ${shellQuote(extPath)}`
    const created = await this.runtime.createTerminal(this.worktreeSelector, {
      command,
      cwd: this.cwd,
      title: 'Dev| Oncall (pi)',
      presentation: 'background'
    })
    this.terminalHandle = created.handle

    const deadline = Date.now() + 10_000
    while (!fs.existsSync(this.sockPath)) {
      if (Date.now() > deadline) {
        throw new Error('Timed out waiting for Pi voice extension socket')
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }

    await this.connectSocket()
    const stateRes = await this.rpc({ type: 'get_state' }).catch(() => null)
    if (stateRes && typeof stateRes.sessionId === 'string') {
      this.sessionId = stateRes.sessionId
      this.sessionFile = typeof stateRes.sessionFile === 'string' ? stateRes.sessionFile : ''
    }
  }

  private async connectSocket(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const sock = net.createConnection(this.sockPath)
      const decoder = new TextDecoder('utf-8')
      sock.once('connect', () => {
        this.sock = sock
        resolve()
      })
      sock.once('error', (err) => {
        if (!this.sock) {
          reject(err)
        }
      })
      sock.on('data', (chunk: Buffer) => {
        this.stdoutBuf += decoder.decode(chunk, { stream: true })
        let lfIdx: number
        while ((lfIdx = this.stdoutBuf.indexOf('\n')) !== -1) {
          let line = this.stdoutBuf.slice(0, lfIdx)
          this.stdoutBuf = this.stdoutBuf.slice(lfIdx + 1)
          if (line.endsWith('\r')) {
            line = line.slice(0, -1)
          }
          if (!line.trim()) {
            continue
          }
          try {
            this.handleRecord(JSON.parse(line) as Record<string, unknown>)
          } catch {}
        }
      })
      sock.on('close', () => {
        if (this.sock === sock) {
          this.sock = null
          this.terminalHandle = null
        }
      })
    })
  }

  private async rpc(cmd: Record<string, unknown>): Promise<Record<string, unknown>> {
    await this.start()
    if (!this.sock || this.sock.destroyed) {
      throw new Error('Pi socket is not connected')
    }
    const id = crypto.randomUUID()
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Pi RPC timeout for ${String(cmd.type)}`))
      }, 15_000)
      this.pending.set(id, {
        resolve: (val) => {
          clearTimeout(timer)
          resolve(val)
        },
        reject: (err) => {
          clearTimeout(timer)
          reject(err)
        }
      })
      this.sock?.write(`${JSON.stringify({ ...cmd, id })}\n`)
    })
  }

  private handleRecord(rec: Record<string, unknown>): void {
    if (rec.type === 'response' && typeof rec.id === 'string') {
      const waiter = this.pending.get(rec.id)
      if (waiter) {
        this.pending.delete(rec.id)
        if (rec.success) {
          waiter.resolve((rec.data as Record<string, unknown>) ?? {})
        } else {
          waiter.reject(new Error(String(rec.error ?? 'Pi RPC error')))
        }
      }
      return
    }
    if (rec.type === 'session_start') {
      if (typeof rec.sessionId === 'string') {
        this.sessionId = rec.sessionId
      }
      if (typeof rec.sessionFile === 'string') {
        this.sessionFile = rec.sessionFile
      }
      return
    }
    if (rec.type === 'agent_start') {
      this.isStreaming = true
      this.currentRunEmittedEnd = false
      this.emit('run_start')
      return
    }
    if (rec.type === 'tool_execution_start') {
      const toolName = String(rec.toolName || 'tool')
      this.currentTool = toolName
      const args = (rec.args as Record<string, unknown>) || {}
      const targetPath = typeof args.path === 'string' ? args.path : ''
      if ((toolName === 'edit' || toolName === 'write') && targetPath) {
        this.modifiedFiles.add(targetPath)
      }
      const detail =
        targetPath || (typeof args.command === 'string' ? args.command.slice(0, 80) : '')
      this.emit('tool_start', { toolName, detail })
      return
    }
    if (rec.type === 'message_update') {
      const ame = rec.assistantMessageEvent as Record<string, unknown> | undefined
      if (ame?.type === 'text_delta' && typeof ame.delta === 'string') {
        this.lastAssistantText += ame.delta
        this.emit('text_delta', ame.delta)
      }
      return
    }
    if (rec.type === 'agent_end' && !this.currentRunEmittedEnd) {
      this.currentRunEmittedEnd = true
      this.isStreaming = false
      this.currentTool = null
      const summary =
        typeof rec.summary === 'string' && rec.summary.trim()
          ? rec.summary.trim()
          : this.lastAssistantText.trim() || 'Task completed.'
      this.lastAssistantText = summary
      this.emit('run_end', { summary, filesChanged: Array.from(this.modifiedFiles) })
    }
  }

  async sendPrompt(prompt: string): Promise<void> {
    this.modifiedFiles.clear()
    this.lastAssistantText = ''
    this.isStreaming = true
    await this.rpc({ type: 'prompt', message: prompt })
  }

  async steer(prompt: string): Promise<void> {
    await this.rpc({ type: 'steer', message: prompt })
  }

  async abort(): Promise<void> {
    try {
      await this.rpc({ type: 'abort' })
    } finally {
      this.isStreaming = false
      this.currentTool = null
    }
  }

  getTerminalHandle(): string | null {
    return this.terminalHandle
  }

  dispose(): void {
    if (this.sock) {
      try {
        this.sock.destroy()
      } catch {}
      this.sock = null
    }
    try {
      fs.rmSync(this.sockPath, { force: true })
    } catch {}
  }
}
