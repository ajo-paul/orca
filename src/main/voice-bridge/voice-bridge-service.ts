import crypto from 'node:crypto'
import path from 'node:path'
import {
  VoiceStreamOpcode,
  encodeVoiceStreamFrame,
  type VoiceStreamFrame
} from '../../shared/voice-stream-protocol'
import type { RpcBinarySender } from '../runtime/rpc/transports/rpc-binary-sender'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { VoiceCallRoom } from './voice-call-room'
import type { VoiceActivityItem, VoiceCallEvent } from './voice-call-types'

export type StartVoiceCallParams = {
  worktreeId: string
  voiceName?: string
  voiceMode?: string
}

export type StartVoiceCallResult = {
  callId: string
  callSeq: number
  room: string
  status: 'connecting' | 'active'
  worktreeId: string
  workspaceName: string
  workspacePath: string
  gitBranch: string
  voiceName: string
  voiceMode: string
}

type VoiceSubscriber = {
  emit: (event: unknown) => void
  sendBinary?: RpcBinarySender
  audioOutSeq: number
}

export class VoiceBridgeService {
  private readonly runtime: OrcaRuntimeService
  private readonly callsById = new Map<string, VoiceCallRoom>()
  private readonly callsBySeq = new Map<number, VoiceCallRoom>()
  private readonly subscribersByCallId = new Map<string, Set<VoiceSubscriber>>()
  private nextCallSeq = 1

  constructor(runtime: OrcaRuntimeService) {
    this.runtime = runtime
  }

  async startCall(params: StartVoiceCallParams): Promise<StartVoiceCallResult> {
    const resolved = await this.runtime.listManagedWorktrees(undefined, 200)
    const match = resolved.worktrees.find(
      (w) => w.id === params.worktreeId || w.path === params.worktreeId
    )
    if (!match) {
      throw new Error(`Worktree not found: ${params.worktreeId}`)
    }

    // Reuse active call on same worktree if already open, or create fresh.
    for (const existing of this.callsById.values()) {
      if (existing.worktreeId === match.id) {
        return {
          callId: existing.callId,
          callSeq: existing.callSeq,
          room: existing.callId,
          status: 'active',
          worktreeId: existing.worktreeId,
          workspaceName: existing.workspaceName,
          workspacePath: existing.workspacePath,
          gitBranch: existing.gitBranch,
          voiceName: existing.voiceName,
          voiceMode: existing.voiceMode
        }
      }
    }

    const callId = `voice-${crypto.randomUUID().slice(0, 12)}`
    const callSeq = this.nextCallSeq++
    const workspaceName = path.basename(match.path) || match.branch || match.id

    const room = new VoiceCallRoom({
      callId,
      callSeq,
      worktreeId: match.id,
      worktreeSelector: `id:${match.id}`,
      workspaceName,
      workspacePath: match.path,
      gitBranch: match.branch,
      voiceName: params.voiceName,
      voiceMode: params.voiceMode,
      runtime: this.runtime
    })

    room.on('event', (event: VoiceCallEvent) => {
      const subs = this.subscribersByCallId.get(callId)
      if (!subs) {
        return
      }
      for (const sub of subs) {
        sub.emit({ type: 'voice_event', callId, event })
      }
    })

    room.on('audioOut24k', (pcmBytes: Buffer) => {
      const subs = this.subscribersByCallId.get(callId)
      if (!subs || subs.size === 0) {
        return
      }
      const payload = new Uint8Array(pcmBytes.buffer, pcmBytes.byteOffset, pcmBytes.byteLength)
      for (const sub of subs) {
        if (sub.sendBinary) {
          const frame = encodeVoiceStreamFrame({
            opcode: VoiceStreamOpcode.AudioOut24k,
            callSeq,
            seq: sub.audioOutSeq++,
            payload
          })
          sub.sendBinary(frame)
        } else {
          sub.emit({
            type: 'voice_audio_out',
            callId,
            pcm24kBase64: pcmBytes.toString('base64')
          })
        }
      }
    })

    room.once('disposed', () => {
      this.callsById.delete(callId)
      this.callsBySeq.delete(callSeq)
      this.subscribersByCallId.delete(callId)
    })

    this.callsById.set(callId, room)
    this.callsBySeq.set(callSeq, room)
    room.start()

    return {
      callId,
      callSeq,
      room: callId,
      status: 'connecting',
      worktreeId: room.worktreeId,
      workspaceName: room.workspaceName,
      workspacePath: room.workspacePath,
      gitBranch: room.gitBranch,
      voiceName: room.voiceName,
      voiceMode: room.voiceMode
    }
  }

  endCall(callId: string): { ended: boolean } {
    const room = this.callsById.get(callId)
    if (!room) {
      return { ended: false }
    }
    room.dispose('Caller ended call')
    return { ended: true }
  }

  setPaused(callId: string, paused: boolean): { paused: boolean } {
    const room = this.callsById.get(callId)
    if (!room) {
      throw new Error(`Call not found: ${callId}`)
    }
    room.setPaused(paused)
    return { paused }
  }

  async sendText(callId: string, text: string, target: 'lead' | 'pi'): Promise<{ ok: boolean }> {
    const room = this.callsById.get(callId)
    if (!room) {
      throw new Error(`Call not found: ${callId}`)
    }
    await room.sendText(text, target)
    return { ok: true }
  }

  async focus(params: {
    worktreeId: string
    target: 'terminal' | 'file' | 'diff' | 'browser' | 'workspace'
    query?: string
    url?: string
    direction?: 'next' | 'prev'
  }): Promise<{ ok: boolean; detail: string }> {
    for (const room of this.callsById.values()) {
      if (room.worktreeId === params.worktreeId) {
        return await room.focusTarget(params)
      }
    }
    const temp = new VoiceCallRoom({
      callId: 'focus-tmp',
      callSeq: 0,
      worktreeId: params.worktreeId,
      worktreeSelector: `id:${params.worktreeId}`,
      workspaceName: params.worktreeId,
      workspacePath: '.',
      gitBranch: '',
      runtime: this.runtime
    })
    return await temp.focusTarget(params)
  }

  handleAudioInBase64(callId: string, pcm16kBase64: string): { ok: boolean } {
    const room = this.callsById.get(callId)
    if (!room) {
      return { ok: false }
    }
    const buf = Buffer.from(pcm16kBase64, 'base64')
    if (buf.length > 0) {
      room.sendAudioIn16k(buf)
    }
    return { ok: true }
  }

  handleAudioInBinary(frame: VoiceStreamFrame): void {
    if (frame.opcode !== VoiceStreamOpcode.AudioIn16k) {
      return
    }
    const room = this.callsBySeq.get(frame.callSeq)
    if (!room || frame.payload.byteLength === 0) {
      return
    }
    room.sendAudioIn16k(
      Buffer.from(frame.payload.buffer, frame.payload.byteOffset, frame.payload.byteLength)
    )
  }

  getStatus(): {
    activeCalls: {
      callId: string
      callSeq: number
      worktreeId: string
      workspaceName: string
      gitBranch: string
      voiceName: string
      voiceMode: string
      activities: VoiceActivityItem[]
    }[]
  } {
    return {
      activeCalls: Array.from(this.callsById.values()).map((r) => ({
        callId: r.callId,
        callSeq: r.callSeq,
        worktreeId: r.worktreeId,
        workspaceName: r.workspaceName,
        gitBranch: r.gitBranch,
        voiceName: r.voiceName,
        voiceMode: r.voiceMode,
        activities: r.activities.slice(-40)
      }))
    }
  }

  subscribe(opts: {
    callId: string
    subscriptionId: string
    connectionId?: string
    emit: (event: unknown) => void
    sendBinary?: RpcBinarySender
  }): Promise<void> {
    const room = this.callsById.get(opts.callId)
    if (!room) {
      throw new Error(`Call not found: ${opts.callId}`)
    }

    return new Promise<void>((resolve) => {
      let subs = this.subscribersByCallId.get(opts.callId)
      if (!subs) {
        subs = new Set()
        this.subscribersByCallId.set(opts.callId, subs)
      }
      const sub: VoiceSubscriber = {
        emit: opts.emit,
        sendBinary: opts.sendBinary,
        audioOutSeq: 0
      }
      subs.add(sub)
      room.setHasSubscribers(true)

      const cleanup = (): void => {
        const current = this.subscribersByCallId.get(opts.callId)
        if (current) {
          current.delete(sub)
          if (current.size === 0) {
            this.subscribersByCallId.delete(opts.callId)
            room.setHasSubscribers(false)
          }
        }
        opts.emit({ type: 'end' })
        resolve()
      }

      this.runtime.registerSubscriptionCleanup(opts.subscriptionId, cleanup, opts.connectionId)

      opts.emit({
        type: 'ready',
        subscriptionId: opts.subscriptionId,
        callId: room.callId,
        callSeq: room.callSeq,
        worktreeId: room.worktreeId,
        workspaceName: room.workspaceName,
        gitBranch: room.gitBranch,
        voiceName: room.voiceName,
        voiceMode: room.voiceMode,
        activities: room.activities.slice(-50)
      })
    })
  }
}

const voiceServices = new WeakMap<OrcaRuntimeService, VoiceBridgeService>()

export function getVoiceBridgeService(runtime: OrcaRuntimeService): VoiceBridgeService {
  let service = voiceServices.get(runtime)
  if (!service) {
    service = new VoiceBridgeService(runtime)
    voiceServices.set(runtime, service)
  }
  return service
}
