import {
  decodeBrowserScreencastFrame,
  type BrowserScreencastFrame
} from '../../browser/screencast/browser-screencast-protocol'
import { decodeVoiceStreamFrame, type VoiceStreamFrame } from '../voice-stream-protocol'

export type VoiceBinaryListener = (frame: VoiceStreamFrame) => void

type VoiceStreamEntry = {
  method: string
  cancelled?: boolean
  onVoiceBinaryFrame?: VoiceBinaryListener
}

export function dispatchVoiceOrBrowserBinary(
  bytes: Uint8Array,
  streams: Iterable<VoiceStreamEntry>,
  onBrowserFrame: (frame: BrowserScreencastFrame) => void
): boolean {
  const voiceFrame = decodeVoiceStreamFrame(bytes)
  if (voiceFrame) {
    for (const stream of streams) {
      if (!stream.cancelled && stream.method === 'voice.subscribe' && stream.onVoiceBinaryFrame) {
        stream.onVoiceBinaryFrame(voiceFrame)
      }
    }
    return true
  }
  const browserFrame = decodeBrowserScreencastFrame(bytes)
  if (browserFrame) {
    onBrowserFrame(browserFrame)
    return true
  }
  return false
}

export function sendSocketBinaryFrame(
  socket: WebSocket,
  framing: { sendBinary: (bytes: Uint8Array) => boolean } | null,
  bytes: Uint8Array,
  onError: () => void
): boolean {
  if (socket.readyState !== WebSocket.OPEN || !framing) {
    return false
  }
  try {
    return framing.sendBinary(bytes)
  } catch {
    onError()
    return false
  }
}
