import { useEffect, useState } from 'react'
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  ChevronLeft,
  FileDiff,
  Globe,
  Mic,
  MicOff,
  Music,
  Pause,
  Phone,
  PhoneOff,
  Play,
  Sparkles,
  Terminal,
  Volume2,
  VolumeX
} from 'lucide-react-native'
import { colors, pressedStyle } from '../theme/mobile-theme'
import { useMobileColorScheme } from '../theme/use-mobile-color-scheme'
import { useVoiceCall } from './voice-call-context'
import {
  VOICE_MODES,
  VOICE_NAMES,
  type VoiceMode,
  type VoiceName,
  type VoiceWorktreeOption
} from './voice-call-types'
import { formatCallDuration } from './voice-event-reducer'
import { voiceCallStyles as styles } from './voice-call-styles'

export function VoiceCallScreen({
  initialWorktreeId,
  onBack
}: {
  initialWorktreeId?: string
  onBack: () => void
}) {
  useMobileColorScheme()
  const insets = useSafeAreaInsets()
  const {
    state,
    elapsedSeconds,
    hostConnected,
    listWorktrees,
    startCall,
    endCall,
    toggleMute,
    toggleSpeaker,
    togglePause,
    toggleHoldAudioAuto,
    sendText,
    focusTarget
  } = useVoiceCall()

  const [worktrees, setWorktrees] = useState<VoiceWorktreeOption[]>([])
  const [selectedWorktree, setSelectedWorktree] = useState(initialWorktreeId || '')
  const [selectedVoice, setSelectedVoice] = useState<VoiceName>(state.voiceName)
  const [selectedMode, setSelectedMode] = useState<VoiceMode>(state.voiceMode)
  const [draft, setDraft] = useState('')
  const [sendTarget, setSendTarget] = useState<'lead' | 'pi'>('lead')

  useEffect(() => {
    if (!hostConnected || state.callId) {
      return
    }
    let cancelled = false
    void listWorktrees().then((items) => {
      if (cancelled) {
        return
      }
      setWorktrees(items)
      if (!selectedWorktree && items[0]) {
        setSelectedWorktree(items[0].id)
      }
    })
    return () => {
      cancelled = true
    }
  }, [hostConnected, listWorktrees, selectedWorktree, state.callId])

  const submitDraft = () => {
    const clean = draft.trim()
    if (!clean) {
      return
    }
    setDraft('')
    void sendText(clean, sendTarget)
  }

  const leadColor =
    state.leadStatus === 'connected'
      ? colors.statusGreen
      : state.leadStatus === 'error'
        ? colors.statusRed
        : colors.statusAmber

  return (
    <View
      style={[
        styles.root,
        { paddingTop: insets.top, paddingBottom: state.callId ? 0 : insets.bottom }
      ]}
    >
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Pressable
            onPress={onBack}
            style={({ pressed }) => [styles.backBtn, pressed && pressedStyle]}
          >
            <ChevronLeft size={18} color={colors.textPrimary} />
          </Pressable>
          <View style={styles.titleWrap}>
            <Text style={styles.title} numberOfLines={1}>
              {state.callId ? state.workspaceName || 'Dev| Oncall' : 'Dev| Oncall'}
            </Text>
            <Text style={styles.subtitle} numberOfLines={1}>
              {state.callId
                ? `${state.gitBranch || 'workspace'} · ${state.voiceMode}`
                : hostConnected
                  ? 'Select a worktree to start a voice call'
                  : 'Connecting to desktop...'}
            </Text>
          </View>
        </View>
        {state.callId ? (
          <View style={styles.timerBadge}>
            <Text style={styles.timerText}>{formatCallDuration(elapsedSeconds)}</Text>
          </View>
        ) : null}
      </View>

      {!state.callId ? (
        <ScrollView style={styles.body} contentContainerStyle={{ paddingBottom: 32 }}>
          <Text style={styles.sectionLabel}>Worktree</Text>
          {worktrees.map((w) => {
            const active = selectedWorktree === w.id
            return (
              <Pressable
                key={w.id}
                onPress={() => setSelectedWorktree(w.id)}
                style={({ pressed }) => [
                  styles.worktreeCard,
                  active && styles.worktreeCardActive,
                  pressed && pressedStyle
                ]}
              >
                <Text style={styles.worktreeName}>{w.name}</Text>
                <Text style={styles.worktreeBranch}>{w.branch}</Text>
              </Pressable>
            )
          })}

          <Text style={styles.sectionLabel}>Team Lead Voice</Text>
          <View style={styles.chipRow}>
            {VOICE_NAMES.map((v) => (
              <Pressable
                key={v}
                onPress={() => setSelectedVoice(v)}
                style={[styles.chip, selectedVoice === v && styles.chipActive]}
              >
                <Text style={[styles.chipText, selectedVoice === v && styles.chipTextActive]}>
                  {v}
                </Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.sectionLabel}>Mode</Text>
          <View style={styles.chipRow}>
            {VOICE_MODES.map((m) => (
              <Pressable
                key={m}
                onPress={() => setSelectedMode(m)}
                style={[styles.chip, selectedMode === m && styles.chipActive]}
              >
                <Text style={[styles.chipText, selectedMode === m && styles.chipTextActive]}>
                  {m}
                </Text>
              </Pressable>
            ))}
          </View>

          {state.error ? <Text style={styles.errorText}>{state.error}</Text> : null}

          <Pressable
            disabled={!hostConnected || !selectedWorktree || state.starting}
            onPress={() =>
              void startCall({
                worktreeId: selectedWorktree,
                voiceName: selectedVoice,
                voiceMode: selectedMode
              })
            }
            style={({ pressed }) => [
              styles.startBtn,
              (!hostConnected || !selectedWorktree || state.starting) && styles.startBtnDisabled,
              pressed && pressedStyle
            ]}
          >
            <Phone size={18} color={colors.onMergeGreen} />
            <Text style={styles.startBtnText}>
              {state.starting ? 'Connecting...' : 'Start Voice Call'}
            </Text>
          </Pressable>
        </ScrollView>
      ) : (
        <>
          <View style={styles.body}>
            <View style={styles.statusCard}>
              <View style={styles.statusRow}>
                <View style={styles.statusBadge}>
                  <View style={[styles.dot, { backgroundColor: leadColor }]} />
                  <Text style={styles.statusTitle}>{`Team Lead (${state.voiceName})`}</Text>
                </View>
                <Text style={styles.statusMeta}>
                  {state.holdAudioQuiet
                    ? 'Hold audio: Spotify'
                    : state.piRunning
                      ? `Pi: ${state.piTool || 'working'}`
                      : state.leadStatus}
                </Text>
              </View>
              {state.leadSubtitle || state.callerSubtitle ? (
                <Text style={styles.subtitleBox} numberOfLines={3}>
                  {state.leadSubtitle || state.callerSubtitle}
                </Text>
              ) : null}
            </View>

            <View style={styles.focusBar}>
              <Pressable onPress={() => void focusTarget('terminal')} style={styles.focusBtn}>
                <Terminal size={14} color={colors.textPrimary} />
                <Text style={styles.focusBtnText}>Terminal</Text>
              </Pressable>
              <Pressable onPress={() => void focusTarget('diff')} style={styles.focusBtn}>
                <FileDiff size={14} color={colors.textPrimary} />
                <Text style={styles.focusBtnText}>Diff</Text>
              </Pressable>
              <Pressable
                onPress={() => void focusTarget('browser', { direction: 'next' })}
                style={styles.focusBtn}
              >
                <Globe size={14} color={colors.textPrimary} />
                <Text style={styles.focusBtnText}>Browser</Text>
              </Pressable>
            </View>

            <ScrollView style={styles.feed}>
              {state.activities.map((item) => (
                <View key={item.id} style={styles.activityRow}>
                  <View style={styles.activityHead}>
                    <Sparkles size={12} color={colors.textSecondary} />
                    <Text style={styles.activityKind}>{item.kind.toUpperCase()}</Text>
                  </View>
                  <Text style={styles.activityText}>{item.text}</Text>
                </View>
              ))}
            </ScrollView>

            <View style={styles.composerRow}>
              <Pressable
                onPress={() => setSendTarget((prev) => (prev === 'lead' ? 'pi' : 'lead'))}
                style={[styles.chip, { paddingVertical: 8 }]}
              >
                <Text style={styles.chipText}>{sendTarget === 'lead' ? 'Lead' : 'Pi'}</Text>
              </Pressable>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                onSubmitEditing={submitDraft}
                placeholder={
                  sendTarget === 'lead' ? 'Message Team Lead...' : 'Steer Pi directly...'
                }
                placeholderTextColor={colors.textMuted}
                style={styles.input}
                returnKeyType="send"
              />
              <Pressable onPress={submitDraft} style={styles.sendChip}>
                <Text style={styles.sendChipText}>Send</Text>
              </Pressable>
            </View>
          </View>

          <View style={[styles.dock, { paddingBottom: insets.bottom + 8 }]}>
            <Pressable
              onPress={toggleMute}
              style={[styles.dockBtn, state.muted && styles.dockBtnActive]}
            >
              {state.muted ? (
                <MicOff size={20} color={colors.statusRed} />
              ) : (
                <Mic size={20} color={colors.textPrimary} />
              )}
              <Text style={styles.dockLabel}>{state.muted ? 'Unmute' : 'Mute'}</Text>
            </Pressable>

            <Pressable
              onPress={toggleSpeaker}
              style={[styles.dockBtn, state.speakerOn && styles.dockBtnActive]}
            >
              {state.speakerOn ? (
                <Volume2 size={20} color={colors.textPrimary} />
              ) : (
                <VolumeX size={20} color={colors.textSecondary} />
              )}
              <Text style={styles.dockLabel}>Speaker</Text>
            </Pressable>

            <Pressable
              onPress={() => void togglePause()}
              style={[styles.dockBtn, state.paused && styles.dockBtnActive]}
            >
              {state.paused ? (
                <Play size={20} color={colors.statusAmber} />
              ) : (
                <Pause size={20} color={colors.textPrimary} />
              )}
              <Text style={styles.dockLabel}>{state.paused ? 'Resume' : 'Hold'}</Text>
            </Pressable>

            <Pressable
              onPress={toggleHoldAudioAuto}
              style={[styles.dockBtn, state.holdAudioAuto && styles.dockBtnActive]}
            >
              <Music
                size={20}
                color={state.holdAudioAuto ? colors.statusGreen : colors.textMuted}
              />
              <Text style={styles.dockLabel}>Music</Text>
            </Pressable>

            <Pressable onPress={() => void endCall()} style={styles.endDockBtn}>
              <PhoneOff size={20} color={colors.onStatusRed} />
            </Pressable>
          </View>
        </>
      )}
    </View>
  )
}
