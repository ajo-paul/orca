import { Pressable, Text, View } from 'react-native'
import { useGlobalSearchParams, usePathname, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Mic, MicOff, Phone, PhoneOff } from 'lucide-react-native'
import { colors, pressedStyle, radii, spacing, typography } from '../theme/mobile-theme'
import { themedStyleSheet } from '../theme/themed-styles'
import { useMobileColorScheme } from '../theme/use-mobile-color-scheme'
import { useVoiceCall } from './voice-call-context'
import { formatCallDuration } from './voice-event-reducer'

export function VoiceCallFloatingLayer({ hostId }: { hostId: string | undefined }) {
  useMobileColorScheme()
  const insets = useSafeAreaInsets()
  const pathname = usePathname()
  const params = useGlobalSearchParams<{ worktreeId?: string }>()
  const router = useRouter()
  const { state, elapsedSeconds, hostConnected, toggleMute, endCall } = useVoiceCall()

  if (!hostId || pathname.endsWith('/voice-call')) {
    return null
  }

  const openVoiceScreen = () => {
    const wt =
      typeof params.worktreeId === 'string' && params.worktreeId
        ? params.worktreeId
        : state.worktreeId || ''
    const base = `/h/${encodeURIComponent(hostId)}/voice-call`
    router.push((wt ? `${base}?worktreeId=${encodeURIComponent(wt)}` : base) as `/h/${string}`)
  }

  const bottom = insets.bottom + spacing.md

  if (!state.callId) {
    if (!hostConnected) {
      return null
    }
    return (
      <View style={[styles.idleWrap, { bottom }]} pointerEvents="box-none">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open Dev Oncall voice dialer"
          onPress={openVoiceScreen}
          style={({ pressed }) => [styles.dialChip, pressed && pressedStyle]}
        >
          <Phone size={16} color={colors.onMergeGreen} />
          <Text style={styles.dialChipText}>Oncall</Text>
        </Pressable>
      </View>
    )
  }

  const dotColor =
    state.paused || state.holdAudioQuiet
      ? colors.statusAmber
      : state.leadStatus === 'connected'
        ? colors.statusGreen
        : colors.accentBlue

  return (
    <View style={[styles.activeWrap, { bottom }]} pointerEvents="box-none">
      <View style={styles.pill}>
        <Pressable
          accessibilityRole="button"
          onPress={openVoiceScreen}
          style={({ pressed }) => [styles.pillMain, pressed && pressedStyle]}
        >
          <View style={[styles.dot, { backgroundColor: dotColor }]} />
          <View style={styles.pillInfo}>
            <Text style={styles.pillTitle} numberOfLines={1}>
              {state.workspaceName || 'Dev| Oncall'}
            </Text>
            <Text style={styles.pillMeta} numberOfLines={1}>
              {`${formatCallDuration(elapsedSeconds)} · ${
                state.piRunning ? state.piTool || 'Pi working' : state.leadStatus
              }`}
            </Text>
          </View>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={state.muted ? 'Unmute microphone' : 'Mute microphone'}
          onPress={toggleMute}
          style={({ pressed }) => [
            styles.iconBtn,
            state.muted && styles.mutedBtn,
            pressed && pressedStyle
          ]}
        >
          {state.muted ? (
            <MicOff size={16} color={colors.statusRed} />
          ) : (
            <Mic size={16} color={colors.textPrimary} />
          )}
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="End voice call"
          onPress={() => void endCall()}
          style={({ pressed }) => [styles.endBtn, pressed && pressedStyle]}
        >
          <PhoneOff size={16} color={colors.onStatusRed} />
        </Pressable>
      </View>
    </View>
  )
}

const styles = themedStyleSheet(() => ({
  idleWrap: {
    position: 'absolute',
    right: spacing.lg,
    zIndex: 40
  },
  dialChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: colors.mergeGreen,
    borderWidth: 1,
    borderColor: colors.floatingCardBorder
  },
  dialChipText: {
    color: colors.onMergeGreen,
    fontSize: typography.metaSize,
    fontWeight: '600'
  },
  activeWrap: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    alignItems: 'center',
    zIndex: 45
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingLeft: spacing.md,
    paddingRight: spacing.xs,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
    backgroundColor: colors.bgPanel,
    borderWidth: 1,
    borderColor: colors.floatingCardBorder,
    maxWidth: 420,
    width: '100%'
  },
  pillMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minWidth: 0
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: radii.pill
  },
  pillInfo: {
    flex: 1,
    minWidth: 0
  },
  pillTitle: {
    color: colors.textPrimary,
    fontSize: typography.metaSize,
    fontWeight: '600'
  },
  pillMeta: {
    color: colors.textSecondary,
    fontSize: 11
  },
  iconBtn: {
    width: 34,
    height: 34,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgRaised
  },
  mutedBtn: {
    backgroundColor: colors.translucentFill
  },
  endBtn: {
    width: 34,
    height: 34,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.statusRed
  }
}))
