import WebSocket from 'ws'
import { resolveDesktopGeminiApiKey } from './gemini-key'
import { TEAM_LEAD_TOOLS } from './voice-team-lead-schema'

export const LIVE_MODEL = 'gemini-3.1-flash-live-preview'

export type GeminiSessionHooks = {
  getSystemPrompt: () => string
  getVoiceName: () => string
  getOpeningGreeting: (isReconnect: boolean) => string
  isEnded: () => boolean
  isPaused: () => boolean
  hasSubscribers: () => boolean
  onStatus: (status: 'connecting' | 'connected' | 'error', detail?: string) => void
  onInterrupted: () => void
  onInputTranscript: (delta: string) => void
  onOutputTranscript: (delta: string) => void
  onTurnComplete: () => void
  onAudioOut24k: (pcm: Buffer) => void
  onToolCall: (
    gws: WebSocket,
    fc: { id: string; name: string; args?: Record<string, unknown> }
  ) => Promise<void>
}

export class VoiceGeminiSession {
  private ws: WebSocket | null = null
  private isReady = false
  private hasGreetedThisConnection = false
  private resumptionHandle = ''
  private rolloverPending = false
  private rolloverTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempt = 0
  private leadSpokeInTurn = false
  private preRollAudio: Buffer[] = []
  private preRollBytes = 0
  private pendingText: string[] = []
  private readonly maxPreRollBytes = 32_000

  constructor(private readonly hooks: GeminiSessionHooks) {}

  connect(isReconnect: boolean): void {
    if (this.hooks.isEnded() || this.hooks.isPaused()) {
      return
    }
    const apiKey = resolveDesktopGeminiApiKey()
    if (!apiKey) {
      this.hooks.onStatus(
        'error',
        'Missing Gemini API key on desktop (GEMINI_API_KEY or ~/.pi/agent/auth.json).'
      )
      return
    }
    this.close()
    this.isReady = false
    this.rolloverPending = false
    this.hooks.onStatus('connecting')

    const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${encodeURIComponent(apiKey)}`
    const gws = new WebSocket(wsUrl)
    this.ws = gws

    gws.on('open', () => {
      if (this.ws !== gws || this.hooks.isEnded()) {
        gws.close()
        return
      }
      gws.send(
        JSON.stringify({
          setup: {
            model: `models/${LIVE_MODEL}`,
            generationConfig: {
              responseModalities: ['AUDIO'],
              speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName: this.hooks.getVoiceName() } }
              }
            },
            systemInstruction: { parts: [{ text: this.hooks.getSystemPrompt() }] },
            realtimeInputConfig: {
              automaticActivityDetection: {
                disabled: false,
                startOfSpeechSensitivity: 'START_SENSITIVITY_HIGH',
                endOfSpeechSensitivity: 'END_SENSITIVITY_LOW',
                prefixPaddingMs: 200,
                silenceDurationMs: 650
              }
            },
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            contextWindowCompression: { slidingWindow: {} },
            sessionResumption: this.resumptionHandle ? { handle: this.resumptionHandle } : {},
            tools: TEAM_LEAD_TOOLS
          }
        })
      )
    })

    gws.on('message', (rawBuf) => {
      if (this.ws === gws && !this.hooks.isEnded()) {
        void this.handleMessage(gws, rawBuf.toString('utf8'), isReconnect)
      }
    })

    gws.on('close', (code, reasonBuf) => {
      if (this.ws !== gws) {
        return
      }
      this.ws = null
      this.isReady = false
      if (this.hooks.isEnded() || this.hooks.isPaused() || !this.hooks.hasSubscribers()) {
        return
      }
      const reasonText = reasonBuf?.toString('utf8') || ''
      if (code === 1007 || code === 1008) {
        this.resumptionHandle = ''
      }
      const delayMs = Math.min(10_000, Math.round(800 * 1.7 ** this.reconnectAttempt))
      this.reconnectAttempt += 1
      this.hooks.onStatus(
        'connecting',
        `Reconnecting Team Lead (${code}${reasonText ? `: ${reasonText.slice(0, 60)}` : ''})...`
      )
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null
        this.connect(true)
      }, delayMs)
    })

    gws.on('error', (err) => {
      if (this.ws === gws) {
        this.hooks.onStatus('error', err.message)
      }
    })
  }

  sendAudio16k(pcmBuffer: Buffer): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.isReady) {
      this.preRollAudio.push(pcmBuffer)
      this.preRollBytes += pcmBuffer.length
      while (this.preRollBytes > this.maxPreRollBytes && this.preRollAudio.length > 0) {
        const dropped = this.preRollAudio.shift()
        if (dropped) {
          this.preRollBytes -= dropped.length
        }
      }
      return
    }
    this.ws.send(
      JSON.stringify({
        realtimeInput: {
          audio: { mimeType: 'audio/pcm;rate=16000', data: pcmBuffer.toString('base64') }
        }
      })
    )
  }

  sendTextOrQueue(text: string): void {
    if (this.ws?.readyState === WebSocket.OPEN && this.isReady && !this.hooks.isPaused()) {
      this.ws.send(JSON.stringify({ realtimeInput: { text } }))
    } else {
      this.pendingText.push(text)
    }
  }

  close(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.rolloverTimer) {
      clearTimeout(this.rolloverTimer)
      this.rolloverTimer = null
    }
    if (this.ws) {
      try {
        this.ws.removeAllListeners()
        this.ws.close()
      } catch {}
      this.ws = null
    }
    this.isReady = false
  }

  private async handleMessage(
    gws: WebSocket,
    rawText: string,
    isReconnect: boolean
  ): Promise<void> {
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(rawText) as Record<string, unknown>
    } catch {
      return
    }
    if (msg.setupComplete) {
      this.isReady = true
      this.reconnectAttempt = 0
      this.hooks.onStatus('connected')
      if (this.preRollAudio.length > 0) {
        for (const buf of this.preRollAudio.splice(0)) {
          gws.send(
            JSON.stringify({
              realtimeInput: {
                audio: { mimeType: 'audio/pcm;rate=16000', data: buf.toString('base64') }
              }
            })
          )
        }
        this.preRollBytes = 0
      }
      if (this.pendingText.length > 0) {
        for (const text of this.pendingText.splice(0)) {
          gws.send(JSON.stringify({ realtimeInput: { text } }))
        }
        return
      }
      if (!this.hasGreetedThisConnection && !this.resumptionHandle) {
        this.hasGreetedThisConnection = true
        gws.send(
          JSON.stringify({ realtimeInput: { text: this.hooks.getOpeningGreeting(isReconnect) } })
        )
      }
      return
    }
    const resumption = msg.sessionResumptionUpdate as { newHandle?: string } | undefined
    if (resumption?.newHandle) {
      this.resumptionHandle = resumption.newHandle
      return
    }
    if (msg.goAway) {
      if (!this.hooks.isEnded() && !this.hooks.isPaused()) {
        this.rolloverPending = true
        if (!this.leadSpokeInTurn) {
          this.executeRollover()
        } else if (!this.rolloverTimer) {
          this.rolloverTimer = setTimeout(() => this.executeRollover(), 15_000)
        }
      }
      return
    }
    const toolCall = msg.toolCall as
      | { functionCalls?: { id: string; name: string; args?: Record<string, unknown> }[] }
      | undefined
    if (toolCall?.functionCalls) {
      for (const fc of toolCall.functionCalls) {
        await this.hooks.onToolCall(gws, fc)
      }
      return
    }
    this.handleServerContent(msg.serverContent as Record<string, unknown> | undefined)
  }

  private handleServerContent(serverContent: Record<string, unknown> | undefined): void {
    if (!serverContent) {
      return
    }
    if (serverContent.interrupted) {
      this.leadSpokeInTurn = false
      this.hooks.onInterrupted()
    }
    const inputTx = serverContent.inputTranscription as { text?: string } | undefined
    if (inputTx?.text) {
      this.hooks.onInputTranscript(inputTx.text)
    }
    const outputTx = serverContent.outputTranscription as { text?: string } | undefined
    if (outputTx?.text) {
      this.hooks.onOutputTranscript(outputTx.text)
    }
    const modelTurn = serverContent.modelTurn as
      | { parts?: { inlineData?: { mimeType?: string; data?: string } }[] }
      | undefined
    if (modelTurn?.parts) {
      for (const part of modelTurn.parts) {
        const data = part.inlineData?.data
        const mime = part.inlineData?.mimeType || ''
        if (data && mime.startsWith('audio/pcm')) {
          this.leadSpokeInTurn = true
          this.hooks.onAudioOut24k(Buffer.from(data, 'base64'))
        }
      }
    }
    if (serverContent.turnComplete) {
      this.leadSpokeInTurn = false
      this.hooks.onTurnComplete()
      if (this.rolloverPending) {
        this.executeRollover()
      }
    }
  }

  private executeRollover(): void {
    this.rolloverPending = false
    if (this.rolloverTimer) {
      clearTimeout(this.rolloverTimer)
      this.rolloverTimer = null
    }
    this.connect(true)
  }
}
