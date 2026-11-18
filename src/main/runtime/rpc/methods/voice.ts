import { defineMethod, defineStreamingMethod } from '../core'
import {
  VoiceAudioInParams,
  VoiceEndCallParams,
  VoiceFocusParams,
  VoicePauseCallParams,
  VoiceSendTextParams,
  VoiceStartCallParams,
  VoiceSubscribeParams,
  VoiceUnsubscribeParams
} from '../../../../shared/rpc-contract/voice-params'
import { getVoiceBridgeService } from '../../../voice-bridge/voice-bridge-service'

let voiceSubscriptionSeq = 0

export const VOICE_METHODS = [
  defineMethod({
    name: 'voice.startCall',
    permission: 'workspace',
    params: VoiceStartCallParams,
    handler: async (params, { runtime }) => getVoiceBridgeService(runtime).startCall(params)
  }),
  defineMethod({
    name: 'voice.endCall',
    permission: 'workspace',
    params: VoiceEndCallParams,
    handler: async (params, { runtime }) => getVoiceBridgeService(runtime).endCall(params.callId)
  }),
  defineMethod({
    name: 'voice.pause',
    permission: 'workspace',
    params: VoicePauseCallParams,
    handler: async (params, { runtime }) =>
      getVoiceBridgeService(runtime).setPaused(params.callId, params.paused)
  }),
  defineMethod({
    name: 'voice.sendText',
    permission: 'workspace',
    params: VoiceSendTextParams,
    handler: async (params, { runtime }) =>
      getVoiceBridgeService(runtime).sendText(params.callId, params.text, params.target)
  }),
  defineMethod({
    name: 'voice.focus',
    permission: 'workspace',
    params: VoiceFocusParams,
    handler: async (params, { runtime }) => getVoiceBridgeService(runtime).focus(params)
  }),
  defineMethod({
    name: 'voice.audioIn',
    permission: 'workspace',
    params: VoiceAudioInParams,
    handler: async (params, { runtime }) =>
      getVoiceBridgeService(runtime).handleAudioInBase64(params.callId, params.pcm16kBase64)
  }),
  defineMethod({
    name: 'voice.status',
    permission: 'workspace',
    params: null,
    handler: async (_params, { runtime }) => getVoiceBridgeService(runtime).getStatus()
  }),
  defineStreamingMethod({
    name: 'voice.subscribe',
    permission: 'workspace',
    params: VoiceSubscribeParams,
    handler: async (params, { runtime, connectionId, sendBinary }, emit) => {
      const seq = ++voiceSubscriptionSeq
      const subscriptionId = `voice-${connectionId ?? 'inproc'}-${seq}`
      await getVoiceBridgeService(runtime).subscribe({
        callId: params.callId,
        subscriptionId,
        connectionId,
        emit,
        sendBinary
      })
    }
  }),
  defineMethod({
    name: 'voice.unsubscribe',
    permission: 'workspace',
    params: VoiceUnsubscribeParams,
    handler: async (params, { runtime }) => {
      runtime.cleanupSubscription(params.subscriptionId)
      return { unsubscribed: true }
    }
  })
] as const
