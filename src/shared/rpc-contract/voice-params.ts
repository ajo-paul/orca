import { z } from 'zod'
import { OptionalString, requiredString } from './rpc-param-primitives'

export const VoiceStartCallParams = z.object({
  worktreeId: requiredString('Missing worktreeId'),
  voiceName: OptionalString,
  voiceMode: OptionalString
})

export const VoiceEndCallParams = z.object({
  callId: requiredString('Missing callId')
})

export const VoicePauseCallParams = z.object({
  callId: requiredString('Missing callId'),
  paused: z.boolean()
})

export const VoiceSendTextParams = z.object({
  callId: requiredString('Missing callId'),
  text: requiredString('Missing text'),
  target: z.enum(['lead', 'pi']).default('lead')
})

export const VoiceFocusParams = z.object({
  worktreeId: requiredString('Missing worktreeId'),
  target: z.enum(['terminal', 'file', 'diff', 'browser', 'workspace']),
  query: OptionalString,
  url: OptionalString,
  direction: z.enum(['next', 'prev']).optional()
})

export const VoiceAudioInParams = z.object({
  callId: requiredString('Missing callId'),
  pcm16kBase64: requiredString('Missing pcm16kBase64')
})

export const VoiceSubscribeParams = z.object({
  callId: requiredString('Missing callId')
})

export const VoiceUnsubscribeParams = z.object({
  subscriptionId: requiredString('Missing subscriptionId')
})
