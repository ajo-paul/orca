import { colors, radii, spacing, typography } from '../theme/mobile-theme'
import { themedStyleSheet } from '../theme/themed-styles'

export const voiceCallStyles = themedStyleSheet(() => ({
  root: { flex: 1, backgroundColor: colors.bgBase },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1, minWidth: 0 },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgRaised
  },
  titleWrap: { flex: 1, minWidth: 0 },
  title: { color: colors.textPrimary, fontSize: typography.bodySize, fontWeight: '700' },
  subtitle: { color: colors.textSecondary, fontSize: typography.metaSize },
  timerBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
    backgroundColor: colors.bgRaised
  },
  timerText: {
    color: colors.textPrimary,
    fontSize: typography.metaSize,
    fontFamily: typography.monoFamily,
    fontWeight: '600'
  },
  body: { flex: 1, paddingHorizontal: spacing.md, paddingTop: spacing.md },
  sectionLabel: {
    color: colors.textSecondary,
    fontSize: typography.metaSize,
    fontWeight: '600',
    marginBottom: spacing.xs,
    marginTop: spacing.md
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radii.pill,
    backgroundColor: colors.bgRaised,
    borderWidth: 1,
    borderColor: colors.borderSubtle
  },
  chipActive: {
    backgroundColor: colors.accentBlue,
    borderColor: colors.accentBlue
  },
  chipText: { color: colors.textPrimary, fontSize: typography.metaSize, fontWeight: '500' },
  chipTextActive: { color: colors.onAccent, fontWeight: '600' },
  worktreeCard: {
    padding: spacing.md,
    borderRadius: radii.control,
    backgroundColor: colors.bgPanel,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    marginBottom: spacing.xs
  },
  worktreeCardActive: { borderColor: colors.accentBlue },
  worktreeName: { color: colors.textPrimary, fontSize: typography.bodySize, fontWeight: '600' },
  worktreeBranch: {
    color: colors.textMuted,
    fontSize: typography.metaSize,
    fontFamily: typography.monoFamily,
    marginTop: 2
  },
  startBtn: {
    marginTop: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.mergeGreen,
    paddingVertical: spacing.md,
    borderRadius: radii.control
  },
  startBtnDisabled: { opacity: 0.5 },
  startBtnText: { color: colors.onMergeGreen, fontSize: typography.bodySize, fontWeight: '700' },
  statusCard: {
    padding: spacing.md,
    borderRadius: radii.surface,
    backgroundColor: colors.bgPanel,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    gap: spacing.xs
  },
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  dot: { width: 8, height: 8, borderRadius: radii.pill },
  statusTitle: { color: colors.textPrimary, fontSize: typography.bodySize, fontWeight: '600' },
  statusMeta: { color: colors.textSecondary, fontSize: typography.metaSize },
  subtitleBox: {
    color: colors.textPrimary,
    fontSize: typography.bodySize,
    lineHeight: 20,
    marginTop: spacing.xs
  },
  focusBar: { flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm },
  focusBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs + 2,
    borderRadius: radii.control,
    backgroundColor: colors.bgRaised,
    borderWidth: 1,
    borderColor: colors.borderSubtle
  },
  focusBtnText: { color: colors.textPrimary, fontSize: typography.metaSize, fontWeight: '500' },
  feed: { flex: 1, marginTop: spacing.sm },
  activityRow: {
    padding: spacing.sm,
    borderRadius: radii.control,
    backgroundColor: colors.bgPanel,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    marginBottom: spacing.xs
  },
  activityHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: 2 },
  activityKind: { color: colors.textSecondary, fontSize: 11, fontWeight: '600' },
  activityText: { color: colors.textPrimary, fontSize: typography.metaSize, lineHeight: 18 },
  composerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingTop: spacing.sm
  },
  input: {
    flex: 1,
    backgroundColor: colors.composerSurface,
    borderWidth: 1,
    borderColor: colors.composerBorder,
    borderRadius: radii.control,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.textPrimary,
    fontSize: typography.bodySize
  },
  sendChip: {
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.sm,
    borderRadius: radii.control,
    backgroundColor: colors.accentBlue,
    alignItems: 'center',
    justifyContent: 'center'
  },
  sendChipText: { color: colors.onAccent, fontSize: typography.metaSize, fontWeight: '600' },
  dock: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
    backgroundColor: colors.bgPanel
  },
  dockBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.control,
    minWidth: 58
  },
  dockBtnActive: { backgroundColor: colors.translucentFill },
  dockLabel: { color: colors.textSecondary, fontSize: 11, fontWeight: '500' },
  endDockBtn: {
    width: 48,
    height: 48,
    borderRadius: radii.pill,
    backgroundColor: colors.statusRed,
    alignItems: 'center',
    justifyContent: 'center'
  },
  errorText: { color: colors.statusRed, fontSize: typography.metaSize, marginTop: spacing.sm }
}))
