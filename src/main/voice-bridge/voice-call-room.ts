import { EventEmitter } from 'node:events'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { resolveDesktopGeminiApiKey } from './gemini-key'
import { PiTerminalWorker } from './pi-terminal-worker'
import { focusVoiceTarget, type VoiceFocusParams } from './voice-focus-controller'
import { LIVE_MODEL, VoiceGeminiSession } from './voice-gemini-session'
import { VALID_MODES, executeVoiceToolCall, type VoiceMode } from './voice-team-lead-tools'
import type { VoiceActivityItem, VoiceCallEvent, VoiceName } from './voice-call-types'
import { getGitBranch, getGitStatusSummary } from './voice-workspace-helpers'

export type { VoiceActivityItem, VoiceCallEvent, VoiceMode, VoiceName }

const VALID_VOICES = new Set<VoiceName>(['Puck', 'Zephyr', 'Kore', 'Charon', 'Fenrir', 'Aoede'])

function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export class VoiceCallRoom extends EventEmitter {
  public readonly callId: string
  public readonly callSeq: number
  public readonly worktreeId: string
  public readonly worktreeSelector: string
  public readonly workspaceName: string
  public readonly workspacePath: string
  public readonly gitBranch: string
  public voiceName: VoiceName
  public voiceMode: VoiceMode

  private readonly runtime: OrcaRuntimeService
  private readonly pi: PiTerminalWorker
  private readonly gemini: VoiceGeminiSession

  private isPausedByCaller = false
  private ended = false
  private subscribersActive = false
  private callerTranscriptBuf = ''
  private leadTranscriptBuf = ''
  private readonly focusState = { lastBrowserFocusIndex: -1 }

  public readonly activities: VoiceActivityItem[] = []

  constructor(opts: {
    callId: string
    callSeq: number
    worktreeId: string
    worktreeSelector: string
    workspaceName: string
    workspacePath: string
    gitBranch: string
    voiceName?: string
    voiceMode?: string
    runtime: OrcaRuntimeService
  }) {
    super()
    this.callId = opts.callId
    this.callSeq = opts.callSeq
    this.worktreeId = opts.worktreeId
    this.worktreeSelector = opts.worktreeSelector
    this.workspaceName = opts.workspaceName
    this.workspacePath = opts.workspacePath
    this.gitBranch = opts.gitBranch
    this.voiceName = VALID_VOICES.has(opts.voiceName as VoiceName)
      ? (opts.voiceName as VoiceName)
      : 'Puck'
    this.voiceMode = VALID_MODES.has(opts.voiceMode as VoiceMode)
      ? (opts.voiceMode as VoiceMode)
      : 'Ship'
    this.runtime = opts.runtime
    this.pi = new PiTerminalWorker({
      runtime: opts.runtime,
      worktreeSelector: opts.worktreeSelector,
      cwd: opts.workspacePath,
      getGeminiApiKey: resolveDesktopGeminiApiKey
    })
    this.gemini = new VoiceGeminiSession({
      getSystemPrompt: () => this.buildSystemPrompt(),
      getVoiceName: () => this.voiceName,
      getOpeningGreeting: (isReconnect) =>
        isReconnect
          ? 'You briefly reconnected on the phone line. Give a quick 1-sentence check-in and continue.'
          : `[System: Caller just connected on ${this.workspaceName} (${this.gitBranch}). Greet them warmly in 1-2 short sentences in English and ask what we are shipping or checking today.]`,
      isEnded: () => this.ended,
      isPaused: () => this.isPausedByCaller,
      hasSubscribers: () => this.subscribersActive,
      onStatus: (status, detail) =>
        this.emitEvent({
          type: 'lead_status',
          status,
          model: LIVE_MODEL,
          voiceName: this.voiceName,
          detail
        }),
      onInterrupted: () => {
        this.emitEvent({ type: 'lead_interrupted' })
        if (this.leadTranscriptBuf.trim()) {
          this.pushActivity('lead', `${this.leadTranscriptBuf.trim()} (interrupted)`)
          this.leadTranscriptBuf = ''
        }
      },
      onInputTranscript: (delta) => {
        this.callerTranscriptBuf += delta
        this.emitEvent({
          type: 'subtitle',
          speaker: 'caller',
          text: this.callerTranscriptBuf,
          final: false
        })
      },
      onOutputTranscript: (delta) => {
        if (this.callerTranscriptBuf.trim()) {
          const callerText = this.callerTranscriptBuf.trim()
          this.emitEvent({ type: 'subtitle', speaker: 'caller', text: callerText, final: true })
          this.pushActivity('caller', callerText)
          this.callerTranscriptBuf = ''
        }
        this.leadTranscriptBuf += delta
        this.emitEvent({
          type: 'subtitle',
          speaker: 'lead',
          text: this.leadTranscriptBuf,
          final: false
        })
      },
      onTurnComplete: () => {
        if (this.leadTranscriptBuf.trim()) {
          const leadText = this.leadTranscriptBuf.trim()
          this.emitEvent({ type: 'subtitle', speaker: 'lead', text: leadText, final: true })
          this.pushActivity('lead', leadText)
          this.leadTranscriptBuf = ''
        }
      },
      onAudioOut24k: (pcm) => this.emit('audioOut24k', pcm),
      onToolCall: async (gws, fc) => {
        if (this.callerTranscriptBuf.trim()) {
          this.pushActivity('caller', this.callerTranscriptBuf.trim())
          this.callerTranscriptBuf = ''
        }
        await executeVoiceToolCall({
          gws,
          fc,
          runtime: this.runtime,
          pi: this.pi,
          worktreeSelector: this.worktreeSelector,
          workspacePath: this.workspacePath,
          gitBranch: this.gitBranch,
          getVoiceMode: () => this.voiceMode,
          setVoiceMode: (mode) => {
            this.voiceMode = mode
            this.emitEvent({ type: 'voice_mode', mode })
          },
          pushActivity: (kind, text) => this.pushActivity(kind, text),
          emitPiAborted: () =>
            this.emitEvent({
              type: 'pi_state',
              running: false,
              tool: null,
              filesChanged: Array.from(this.pi.modifiedFiles),
              gitBranch: this.gitBranch
            }),
          focusTarget: (args) => this.focusTarget(args),
          endCall: (reason) => setTimeout(() => this.dispose(reason), 1500)
        })
      }
    })
    this.wirePiEvents()
  }

  private wirePiEvents(): void {
    this.pi.on('run_start', () => {
      this.emitEvent({
        type: 'pi_state',
        running: true,
        tool: 'thinking',
        filesChanged: Array.from(this.pi.modifiedFiles),
        gitBranch: this.gitBranch
      })
    })
    this.pi.on('tool_start', ({ toolName, detail }: { toolName: string; detail: string }) => {
      this.pushActivity('pi_tool', `${toolName}: ${detail}`.trim())
      this.emitEvent({
        type: 'pi_state',
        running: true,
        tool: detail || toolName,
        filesChanged: Array.from(this.pi.modifiedFiles),
        gitBranch: this.gitBranch
      })
    })
    this.pi.on('text_delta', (delta: string) => {
      this.emitEvent({ type: 'pi_text_delta', delta })
    })
    this.pi.on(
      'run_end',
      ({ summary, filesChanged }: { summary: string; filesChanged: string[] }) => {
        const compactSummary = (summary || 'Task finished.').slice(0, 6000)
        this.pushActivity('pi_output', compactSummary)
        const branch = getGitBranch(this.workspacePath)
        this.emitEvent({
          type: 'pi_state',
          running: false,
          tool: null,
          filesChanged,
          gitBranch: branch,
          summary: compactSummary
        })
        const gitStatus = getGitStatusSummary(this.workspacePath).slice(0, 500)
        const completionPrompt = `[PI TEAM COMPLETED]: Pi finished! Modified files: ${
          filesChanged.join(', ') || 'none'
        }. Git status: ${gitStatus}. Report: ${compactSummary}. Welcome the caller back off hold and summarize results aloud.`

        if (!this.ended) {
          this.gemini.sendTextOrQueue(completionPrompt)
          if (this.isPausedByCaller) {
            this.setPaused(false)
          }
        }
      }
    )
  }

  private emitEvent(event: VoiceCallEvent): void {
    this.emit('event', event)
  }

  private pushActivity(kind: VoiceActivityItem['kind'], text: string): void {
    if (!text.trim()) {
      return
    }
    const item: VoiceActivityItem = { id: makeId(), ts: new Date().toISOString(), kind, text }
    this.activities.push(item)
    if (this.activities.length > 200) {
      this.activities.shift()
    }
    this.emitEvent({ type: 'activity', item })
  }

  public start(): void {
    this.subscribersActive = true
    this.gemini.connect(false)
  }

  public setHasSubscribers(active: boolean): void {
    this.subscribersActive = active
  }

  public setPaused(paused: boolean): void {
    if (this.ended || this.isPausedByCaller === paused) {
      return
    }
    this.isPausedByCaller = paused
    if (paused) {
      this.gemini.close()
      this.emitEvent({ type: 'lead_status', status: 'paused' })
      this.pushActivity('system', 'Call paused.')
    } else {
      this.pushActivity('system', 'Call resumed.')
      this.gemini.connect(true)
    }
  }

  public sendAudioIn16k(pcmBuffer: Buffer): void {
    if (this.ended || this.isPausedByCaller || pcmBuffer.length === 0) {
      return
    }
    this.gemini.sendAudio16k(pcmBuffer)
  }

  public async sendText(text: string, target: 'lead' | 'pi'): Promise<void> {
    const clean = text.trim()
    if (!clean || this.ended) {
      return
    }
    this.pushActivity('caller', clean)
    if (target === 'pi') {
      await (this.pi.isStreaming ? this.pi.steer(clean) : this.pi.sendPrompt(clean))
      return
    }
    if (this.isPausedByCaller) {
      this.setPaused(false)
    }
    this.gemini.sendTextOrQueue(clean)
  }

  public focusTarget(args: VoiceFocusParams): Promise<{ ok: boolean; detail: string }> {
    return focusVoiceTarget(this.runtime, this.worktreeSelector, args, this.focusState)
  }

  private buildSystemPrompt(): string {
    const recent = this.activities
      .slice(-8)
      .map((a) => `[${a.kind}] ${a.text.slice(0, 300)}`)
      .join('\n')
    return [
      "You are Dev| Oncall, the caller's dedicated senior engineering Team Lead inside Orca Mobile.",
      'SPEECH STYLE: Warm, confident, concise phone call style. Speak strictly in English unless requested otherwise.',
      'ANTI-HALLUCINATION RULE: Never invent file contents, test outputs, or completion status.',
      `ACTIVE WORKSPACE: ${this.workspaceName} (${this.workspacePath}), git branch: ${this.gitBranch}, mode: ${this.voiceMode}.`,
      'Use dispatch_to_pi for coding/debugging/tests, read_workspace_file for direct reads, and orca_focus/orca_launch_harness for desktop control.',
      'Ask for verbal confirmation before git commit, git push, or destructive deletes.',
      recent ? `Recent activity:\n${recent}` : ''
    ]
      .filter(Boolean)
      .join('\n')
  }

  public dispose(reason = 'Call ended'): void {
    if (this.ended) {
      return
    }
    this.ended = true
    this.gemini.close()
    this.pi.dispose()
    this.emitEvent({ type: 'call_ended', reason })
    this.emit('disposed')
  }
}
