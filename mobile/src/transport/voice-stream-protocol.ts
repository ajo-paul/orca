export const VOICE_STREAM_KIND = 0x76
export const VOICE_STREAM_VERSION = 1
export const VOICE_STREAM_HEADER_BYTES = 12

export enum VoiceStreamOpcode {
  AudioIn16k = 1,
  AudioOut24k = 2
}

export type VoiceStreamFrame = {
  opcode: VoiceStreamOpcode
  callSeq: number
  seq: number
  payload: Uint8Array
}

export function isVoiceStreamFrame(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= VOICE_STREAM_HEADER_BYTES &&
    bytes[0] === VOICE_STREAM_KIND &&
    bytes[1] === VOICE_STREAM_VERSION
  )
}

export function encodeVoiceStreamFrame(frame: VoiceStreamFrame): Uint8Array {
  const out = new Uint8Array(VOICE_STREAM_HEADER_BYTES + frame.payload.length)
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength)
  view.setUint8(0, VOICE_STREAM_KIND)
  view.setUint8(1, VOICE_STREAM_VERSION)
  view.setUint8(2, frame.opcode)
  view.setUint8(3, 0)
  view.setUint32(4, frame.callSeq >>> 0, true)
  view.setUint32(8, frame.seq >>> 0, true)
  out.set(frame.payload, VOICE_STREAM_HEADER_BYTES)
  return out
}

export function decodeVoiceStreamFrame(bytes: Uint8Array): VoiceStreamFrame | null {
  if (!isVoiceStreamFrame(bytes)) {
    return null
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const opcode = view.getUint8(2)
  if (opcode !== VoiceStreamOpcode.AudioIn16k && opcode !== VoiceStreamOpcode.AudioOut24k) {
    return null
  }
  return {
    opcode,
    callSeq: view.getUint32(4, true),
    seq: view.getUint32(8, true),
    payload: bytes.subarray(VOICE_STREAM_HEADER_BYTES)
  }
}
