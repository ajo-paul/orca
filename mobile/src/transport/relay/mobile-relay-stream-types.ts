import type { RpcClient } from '../rpc/rpc-client-contract'
import type { RpcEnvelopeFields } from '../rpc/rpc-envelope-fields'
import type { VoiceBinaryListener } from '../rpc/voice-binary-dispatch'

export type StreamRecord = {
  method: string
  params: unknown
  envelope?: RpcEnvelopeFields
  listener?: (result: unknown) => void
  onBinaryFrame?: Parameters<RpcClient['subscribe']>[3] extends
    | { onBinaryFrame?: infer Listener }
    | undefined
    ? Listener
    : never
  onVoiceBinaryFrame?: VoiceBinaryListener
  streamIds: Set<number>
  subscriptionId?: string
  cancelled: boolean
  sendOrder: number | null
  receivedSnapshot?: boolean
}

export type StreamUnsubscribe = { method: string; params: Record<string, unknown> }

export function unsubscribeSlot(
  { method, params }: StreamUnsubscribe,
  envelope: RpcEnvelopeFields | undefined
): string | null {
  if (!('subscriptionId' in params)) {
    return null
  }
  const client =
    'client' in params && typeof params.client === 'object' && params.client !== null
      ? params.client
      : null
  const clientId = client && 'id' in client ? client.id : null
  const routing = envelope ? Object.entries(envelope).sort(([a], [b]) => (a < b ? -1 : 1)) : null
  return JSON.stringify([method, params.subscriptionId, clientId, routing])
}
