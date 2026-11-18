import {
  addExpoTwoWayAudioEventListener,
  initialize,
  interruptPlayback,
  playPcm24k,
  requestMicrophonePermissionsAsync,
  setHoldAudioMode,
  setSpeakerOutput,
  tearDown,
  toggleRecording
} from '@orca/expo-two-way-audio'
import { encodeBase64Bytes } from '../transport/encryption/base64-byte-codec'
import type { RpcClient } from '../transport/rpc/rpc-client-contract'
import { VoiceStreamOpcode, encodeVoiceStreamFrame } from '../transport/voice-stream-protocol'

export type NativeVoiceAudioHandles = {
  dispose: () => void
  setMuted: (muted: boolean) => void
  setSpeaker: (enabled: boolean) => void
  setHoldQuiet: (quiet: boolean) => void
  playAudioOut24k: (pcmBytes: Uint8Array) => void
  playAudioOut24kBase64: (base64Data: string) => void
  interruptLeadPlayback: () => void
}

export async function startNativeVoiceAudio(opts: {
  client: RpcClient
  callId: string
  callSeq: number
  speakerOn: boolean
  onMicLevel: (level: number) => void
  onLeadPlayback: (speaking: boolean, rms: number) => void
}): Promise<NativeVoiceAudioHandles> {
  const perm = await requestMicrophonePermissionsAsync()
  if (!perm.granted) {
    throw new Error('Microphone permission is required for Dev| Oncall voice calls.')
  }
  const ok = await initialize()
  if (!ok) {
    throw new Error('Could not initialize native two-way audio engine.')
  }

  let disposed = false
  let muted = false
  let holdQuiet = false
  let seq = 0

  setSpeakerOutput(opts.speakerOn)
  toggleRecording(true)

  const micSub = addExpoTwoWayAudioEventListener('onMicrophoneData', (event) => {
    if (disposed || muted || holdQuiet) {
      return
    }
    const raw = event.data
    const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw)
    if (bytes.byteLength === 0) {
      return
    }
    const frame = encodeVoiceStreamFrame({
      opcode: VoiceStreamOpcode.AudioIn16k,
      callSeq: opts.callSeq,
      seq: seq++,
      payload: bytes
    })
    const sent = opts.client.sendBinaryFrame?.(frame) ?? false
    if (!sent) {
      void opts.client
        .sendRequest('voice.audioIn', {
          callId: opts.callId,
          pcm16kBase64: encodeBase64Bytes(bytes)
        })
        .catch(() => {})
    }
  })

  const micLvlSub = addExpoTwoWayAudioEventListener('onInputVolumeLevelData', (ev) => {
    if (!disposed) {
      opts.onMicLevel(ev.data)
    }
  })

  const playStateSub = addExpoTwoWayAudioEventListener('onPlaybackStateChange', (ev) => {
    if (!disposed) {
      opts.onLeadPlayback(Boolean(ev.speaking), Number(ev.rms) || 0)
    }
  })

  return {
    setMuted: (nextMuted) => {
      muted = nextMuted
      if (!disposed && !holdQuiet) {
        toggleRecording(!nextMuted)
      }
    },
    setSpeaker: (enabled) => {
      if (!disposed) {
        setSpeakerOutput(enabled)
      }
    },
    setHoldQuiet: (quiet) => {
      holdQuiet = quiet
      if (!disposed) {
        setHoldAudioMode(quiet)
      }
    },
    playAudioOut24k: (pcmBytes) => {
      if (disposed) {
        return
      }
      if (holdQuiet) {
        holdQuiet = false
        setHoldAudioMode(false)
      }
      playPcm24k(encodeBase64Bytes(pcmBytes))
    },
    playAudioOut24kBase64: (base64Data) => {
      if (disposed) {
        return
      }
      if (holdQuiet) {
        holdQuiet = false
        setHoldAudioMode(false)
      }
      playPcm24k(base64Data)
    },
    interruptLeadPlayback: () => {
      if (!disposed) {
        interruptPlayback()
      }
    },
    dispose: () => {
      if (disposed) {
        return
      }
      disposed = true
      micSub.remove()
      micLvlSub.remove()
      playStateSub.remove()
      try {
        interruptPlayback()
        setHoldAudioMode(false)
        toggleRecording(false)
        tearDown()
      } catch {}
    }
  }
}
