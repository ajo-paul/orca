import type { NativeVoiceAudioHandles } from './voice-audio-bridge'
import {
  INITIAL_VOICE_CALL_STATE,
  type VoiceActivityItem,
  type VoiceCallState,
  type VoiceMode
} from './voice-call-types'

type VoiceServerEvent =
  | { type: 'lead_status'; status: VoiceCallState['leadStatus']; detail?: string }
  | { type: 'lead_interrupted' }
  | { type: 'subtitle'; speaker: 'caller' | 'lead'; text: string; final: boolean }
  | {
      type: 'pi_state'
      running: boolean
      tool: string | null
      filesChanged: string[]
      gitBranch?: string
    }
  | { type: 'activity'; item: VoiceActivityItem }
  | { type: 'voice_mode'; mode: VoiceMode }
  | { type: 'call_ended'; reason: string }

export function formatCallDuration(totalSeconds: number): string {
  const hrs = Math.floor(totalSeconds / 3600)
  const mins = Math.floor((totalSeconds % 3600) / 60)
  const secs = totalSeconds % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return hrs > 0 ? `${hrs}:${pad(mins)}:${pad(secs)}` : `${mins}:${pad(secs)}`
}

export function reduceVoiceServerMessage(
  prev: VoiceCallState,
  msg: Record<string, unknown>,
  audio: NativeVoiceAudioHandles | null,
  onCallEnded: () => void
): VoiceCallState {
  if (msg.type === 'ready') {
    const activities = Array.isArray(msg.activities)
      ? (msg.activities as VoiceActivityItem[])
      : prev.activities
    return { ...prev, activities }
  }
  if (msg.type === 'voice_audio_out' && typeof msg.pcm24kBase64 === 'string') {
    audio?.playAudioOut24kBase64(msg.pcm24kBase64)
    return prev.holdAudioQuiet ? { ...prev, holdAudioQuiet: false } : prev
  }
  if (msg.type !== 'voice_event' || !msg.event || typeof msg.event !== 'object') {
    return prev
  }
  const ev = msg.event as VoiceServerEvent
  if (ev.type === 'lead_interrupted') {
    audio?.interruptLeadPlayback()
    return { ...prev, leadSpeaking: false, leadRms: 0 }
  }
  if (ev.type === 'lead_status') {
    return { ...prev, leadStatus: ev.status, leadDetail: ev.detail ?? null }
  }
  if (ev.type === 'subtitle') {
    return ev.speaker === 'caller'
      ? { ...prev, callerSubtitle: ev.text }
      : { ...prev, leadSubtitle: ev.text }
  }
  if (ev.type === 'pi_state') {
    if (!ev.running && prev.holdAudioQuiet) {
      audio?.setHoldQuiet(false)
    }
    return {
      ...prev,
      piRunning: ev.running,
      piTool: ev.tool,
      filesChanged: ev.filesChanged,
      gitBranch: ev.gitBranch ?? prev.gitBranch,
      holdAudioQuiet: ev.running ? prev.holdAudioQuiet : false
    }
  }
  if (ev.type === 'activity') {
    return { ...prev, activities: [...prev.activities.slice(-149), ev.item] }
  }
  if (ev.type === 'voice_mode') {
    return { ...prev, voiceMode: ev.mode }
  }
  if (ev.type === 'call_ended') {
    onCallEnded()
    return {
      ...INITIAL_VOICE_CALL_STATE,
      voiceName: prev.voiceName,
      voiceMode: prev.voiceMode,
      holdAudioAuto: prev.holdAudioAuto
    }
  }
  return prev
}
