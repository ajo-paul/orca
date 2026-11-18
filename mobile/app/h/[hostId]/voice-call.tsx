import { useLocalSearchParams, useRouter } from 'expo-router'
import { firstParam } from '../../../src/navigation/route-param-reader'
import { VoiceCallScreen } from '../../../src/voice/VoiceCallScreen'

export default function VoiceCallRoute() {
  const params = useLocalSearchParams<{ worktreeId?: string | string[] }>()
  const router = useRouter()
  return (
    <VoiceCallScreen
      initialWorktreeId={firstParam(params.worktreeId)}
      onBack={() => router.back()}
    />
  )
}
