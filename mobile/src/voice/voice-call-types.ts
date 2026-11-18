export type VoiceLeadStatus = 'idle' | 'connecting' | 'connected' | 'paused' | 'error'
export type VoiceMode = 'Scout' | 'Ship' | 'Review' | 'Pocket'
export type VoiceName = 'Puck' | 'Zephyr' | 'Kore' | 'Charon' | 'Fenrir' | 'Aoede'

export type VoiceActivityItem = {
  id: string
  ts: string
  kind: 'caller' | 'lead' | 'pi_prompt' | 'pi_tool' | 'pi_output' | 'system'
  text: string
}

export type VoiceSubtitle = {
  speaker: 'caller' | 'lead'
  text: string
  final: boolean
}

export type VoiceWorktreeOption = {
  id: string
  branch: string
  path: string
  name: string
}

export type VoiceCallState = {
  callId: string | null
  callSeq: number
  worktreeId: string | null
  workspaceName: string
  gitBranch: string
  voiceName: VoiceName
  voiceMode: VoiceMode
  leadStatus: VoiceLeadStatus
  leadDetail: string | null
  piRunning: boolean
  piTool: string | null
  filesChanged: string[]
  callerSubtitle: string
  leadSubtitle: string
  activities: VoiceActivityItem[]
  muted: boolean
  speakerOn: boolean
  paused: boolean
  holdAudioAuto: boolean
  holdAudioQuiet: boolean
  starting: boolean
  error: string | null
  startedAt: number | null
  micRms: number
  leadRms: number
  leadSpeaking: boolean
}

export const VOICE_NAMES: readonly VoiceName[] = [
  'Puck',
  'Zephyr',
  'Kore',
  'Charon',
  'Fenrir',
  'Aoede'
]

export const VOICE_MODES: readonly VoiceMode[] = ['Scout', 'Ship', 'Review', 'Pocket']

export const INITIAL_VOICE_CALL_STATE: VoiceCallState = {
  callId: null,
  callSeq: 0,
  worktreeId: null,
  workspaceName: '',
  gitBranch: '',
  voiceName: 'Puck',
  voiceMode: 'Ship',
  leadStatus: 'idle',
  leadDetail: null,
  piRunning: false,
  piTool: null,
  filesChanged: [],
  callerSubtitle: '',
  leadSubtitle: '',
  activities: [],
  muted: false,
  speakerOn: true,
  paused: false,
  holdAudioAuto: true,
  holdAudioQuiet: false,
  starting: false,
  error: null,
  startedAt: null,
  micRms: 0,
  leadRms: 0,
  leadSpeaking: false
}
