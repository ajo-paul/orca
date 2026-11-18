import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import { useHostClient } from '../transport/connection/host-client-hooks'
import { VoiceStreamOpcode } from '../transport/voice-stream-protocol'
import { startNativeVoiceAudio, type NativeVoiceAudioHandles } from './voice-audio-bridge'
import {
  INITIAL_VOICE_CALL_STATE,
  type VoiceCallState,
  type VoiceMode,
  type VoiceName,
  type VoiceWorktreeOption
} from './voice-call-types'
import { reduceVoiceServerMessage } from './voice-event-reducer'

type VoiceCallContextValue = {
  state: VoiceCallState
  elapsedSeconds: number
  hostConnected: boolean
  listWorktrees: () => Promise<VoiceWorktreeOption[]>
  startCall: (opts: {
    worktreeId: string
    voiceName?: VoiceName
    voiceMode?: VoiceMode
  }) => Promise<void>
  endCall: () => Promise<void>
  toggleMute: () => void
  toggleSpeaker: () => void
  togglePause: () => Promise<void>
  toggleHoldAudioAuto: () => void
  sendText: (text: string, target: 'lead' | 'pi') => Promise<void>
  focusTarget: (
    target: 'terminal' | 'file' | 'diff' | 'browser' | 'workspace',
    opts?: { query?: string; url?: string; direction?: 'next' | 'prev' }
  ) => Promise<void>
}

const VoiceCallContext = createContext<VoiceCallContextValue | null>(null)

export function VoiceCallHostProvider({
  hostId,
  children
}: {
  hostId: string | undefined
  children: ReactNode
}) {
  const { client, state: connState } = useHostClient(hostId)
  const [state, setState] = useState<VoiceCallState>(INITIAL_VOICE_CALL_STATE)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const stateRef = useRef(state)
  stateRef.current = state
  const audioRef = useRef<NativeVoiceAudioHandles | null>(null)
  const unsubRef = useRef<(() => void) | null>(null)

  const cleanupMediaAndSubscription = useCallback(() => {
    unsubRef.current?.()
    unsubRef.current = null
    audioRef.current?.dispose()
    audioRef.current = null
  }, [])

  useEffect(() => cleanupMediaAndSubscription, [cleanupMediaAndSubscription])

  useEffect(() => {
    if (!state.callId || !state.startedAt) {
      setElapsedSeconds(0)
      return
    }
    const tick = () => {
      setElapsedSeconds(
        Math.max(0, Math.floor((Date.now() - (state.startedAt ?? Date.now())) / 1000))
      )
    }
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [state.callId, state.startedAt])

  const listWorktrees = useCallback(async (): Promise<VoiceWorktreeOption[]> => {
    if (!client) {
      return []
    }
    const res = await client.sendRequest('worktree.list', { limit: 100 })
    if (!res.ok || !res.result || typeof res.result !== 'object') {
      return []
    }
    const worktrees = (res.result as { worktrees?: { id: string; branch: string; path: string }[] })
      .worktrees
    if (!Array.isArray(worktrees)) {
      return []
    }
    return worktrees.map((w) => ({
      id: w.id,
      branch: w.branch,
      path: w.path,
      name: w.path.replace(/\/+$/, '').split('/').at(-1) || w.branch || w.id
    }))
  }, [client])

  const startCall = useCallback(
    async (opts: { worktreeId: string; voiceName?: VoiceName; voiceMode?: VoiceMode }) => {
      if (!client) {
        setState((prev) => ({ ...prev, error: 'Host is not connected yet.' }))
        return
      }
      cleanupMediaAndSubscription()
      setState((prev) => ({
        ...prev,
        starting: true,
        error: null,
        voiceName: opts.voiceName ?? prev.voiceName,
        voiceMode: opts.voiceMode ?? prev.voiceMode
      }))
      try {
        const res = await client.sendRequest('voice.startCall', {
          worktreeId: opts.worktreeId,
          voiceName: opts.voiceName ?? stateRef.current.voiceName,
          voiceMode: opts.voiceMode ?? stateRef.current.voiceMode
        })
        if (!res.ok) {
          throw new Error(res.error.message)
        }
        const data = res.result as {
          callId: string
          callSeq: number
          worktreeId: string
          workspaceName: string
          gitBranch: string
          voiceName: VoiceName
          voiceMode: VoiceMode
        }
        const handles = await startNativeVoiceAudio({
          client,
          callId: data.callId,
          callSeq: data.callSeq,
          speakerOn: stateRef.current.speakerOn,
          onMicLevel: (micRms) => setState((prev) => ({ ...prev, micRms })),
          onLeadPlayback: (leadSpeaking, leadRms) => {
            setState((prev) => {
              const releaseForSpotify =
                !leadSpeaking && prev.piRunning && prev.holdAudioAuto && !prev.paused
              if (releaseForSpotify && !prev.holdAudioQuiet) {
                audioRef.current?.setHoldQuiet(true)
              }
              return {
                ...prev,
                leadSpeaking,
                leadRms,
                holdAudioQuiet: releaseForSpotify ? true : prev.holdAudioQuiet
              }
            })
          }
        })
        audioRef.current = handles
        unsubRef.current = client.subscribe(
          'voice.subscribe',
          { callId: data.callId },
          (ev) => {
            if (ev && typeof ev === 'object') {
              setState((prev) =>
                reduceVoiceServerMessage(
                  prev,
                  ev as Record<string, unknown>,
                  audioRef.current,
                  cleanupMediaAndSubscription
                )
              )
            }
          },
          {
            onVoiceBinaryFrame: (frame) => {
              if (
                frame.opcode === VoiceStreamOpcode.AudioOut24k &&
                frame.callSeq === data.callSeq
              ) {
                setState((prev) =>
                  prev.holdAudioQuiet ? { ...prev, holdAudioQuiet: false } : prev
                )
                handles.playAudioOut24k(frame.payload)
              }
            }
          }
        )
        setState((prev) => ({
          ...prev,
          callId: data.callId,
          callSeq: data.callSeq,
          worktreeId: data.worktreeId,
          workspaceName: data.workspaceName,
          gitBranch: data.gitBranch,
          voiceName: data.voiceName,
          voiceMode: data.voiceMode,
          leadStatus: 'connecting',
          starting: false,
          startedAt: Date.now()
        }))
      } catch (err) {
        cleanupMediaAndSubscription()
        setState((prev) => ({
          ...prev,
          starting: false,
          error: err instanceof Error ? err.message : String(err)
        }))
      }
    },
    [cleanupMediaAndSubscription, client]
  )

  const endCall = useCallback(async () => {
    const activeCallId = stateRef.current.callId
    cleanupMediaAndSubscription()
    setState((prev) => ({
      ...INITIAL_VOICE_CALL_STATE,
      voiceName: prev.voiceName,
      voiceMode: prev.voiceMode,
      holdAudioAuto: prev.holdAudioAuto
    }))
    if (client && activeCallId) {
      await client.sendRequest('voice.endCall', { callId: activeCallId }).catch(() => {})
    }
  }, [cleanupMediaAndSubscription, client])

  const toggleMute = useCallback(() => {
    setState((prev) => {
      const muted = !prev.muted
      audioRef.current?.setMuted(muted)
      return { ...prev, muted }
    })
  }, [])

  const toggleSpeaker = useCallback(() => {
    setState((prev) => {
      const speakerOn = !prev.speakerOn
      audioRef.current?.setSpeaker(speakerOn)
      return { ...prev, speakerOn }
    })
  }, [])

  const togglePause = useCallback(async () => {
    const callId = stateRef.current.callId
    if (!client || !callId) {
      return
    }
    const paused = !stateRef.current.paused
    audioRef.current?.setHoldQuiet(paused)
    setState((prev) => ({ ...prev, paused, holdAudioQuiet: paused }))
    await client.sendRequest('voice.pause', { callId, paused }).catch(() => {})
  }, [client])

  const toggleHoldAudioAuto = useCallback(() => {
    setState((prev) => {
      const holdAudioAuto = !prev.holdAudioAuto
      if (!holdAudioAuto && prev.holdAudioQuiet) {
        audioRef.current?.setHoldQuiet(false)
      }
      return { ...prev, holdAudioAuto, holdAudioQuiet: holdAudioAuto ? prev.holdAudioQuiet : false }
    })
  }, [])

  const sendText = useCallback(
    async (text: string, target: 'lead' | 'pi') => {
      const callId = stateRef.current.callId
      if (!client || !callId || !text.trim()) {
        return
      }
      await client.sendRequest('voice.sendText', { callId, text: text.trim(), target })
    },
    [client]
  )

  const focusTarget = useCallback(
    async (
      target: 'terminal' | 'file' | 'diff' | 'browser' | 'workspace',
      opts?: { query?: string; url?: string; direction?: 'next' | 'prev' }
    ) => {
      const worktreeId = stateRef.current.worktreeId
      if (!client || !worktreeId) {
        return
      }
      await client.sendRequest('voice.focus', { worktreeId, target, ...opts }).catch(() => {})
    },
    [client]
  )

  const value = useMemo<VoiceCallContextValue>(
    () => ({
      state,
      elapsedSeconds,
      hostConnected: connState === 'connected',
      listWorktrees,
      startCall,
      endCall,
      toggleMute,
      toggleSpeaker,
      togglePause,
      toggleHoldAudioAuto,
      sendText,
      focusTarget
    }),
    [
      connState,
      elapsedSeconds,
      endCall,
      focusTarget,
      listWorktrees,
      sendText,
      startCall,
      state,
      toggleHoldAudioAuto,
      toggleMute,
      togglePause,
      toggleSpeaker
    ]
  )

  return <VoiceCallContext.Provider value={value}>{children}</VoiceCallContext.Provider>
}

export function useVoiceCall(): VoiceCallContextValue {
  const ctx = useContext(VoiceCallContext)
  if (!ctx) {
    throw new Error('useVoiceCall must be used inside VoiceCallHostProvider')
  }
  return ctx
}
