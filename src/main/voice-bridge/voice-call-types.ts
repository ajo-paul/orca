export type VoiceMode = 'Scout' | 'Ship' | 'Review' | 'Pocket'
export type VoiceName = 'Puck' | 'Zephyr' | 'Kore' | 'Charon' | 'Fenrir' | 'Aoede'

export type VoiceActivityItem = {
  id: string
  ts: string
  kind: 'caller' | 'lead' | 'pi_prompt' | 'pi_tool' | 'pi_output' | 'system'
  text: string
}

export type VoiceCallEvent =
  | {
      type: 'lead_status'
      status: 'connecting' | 'connected' | 'paused' | 'error'
      model?: string
      voiceName?: string
      detail?: string
    }
  | { type: 'lead_interrupted' }
  | { type: 'subtitle'; speaker: 'caller' | 'lead'; text: string; final: boolean }
  | {
      type: 'pi_state'
      running: boolean
      tool: string | null
      filesChanged: string[]
      gitBranch?: string
      summary?: string
    }
  | { type: 'pi_text_delta'; delta: string }
  | { type: 'activity'; item: VoiceActivityItem }
  | { type: 'voice_mode'; mode: VoiceMode }
  | { type: 'call_ended'; reason: string }
