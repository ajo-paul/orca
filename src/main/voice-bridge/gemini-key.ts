import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

function readJsonFileSafe(filePath: string): Record<string, unknown> | null {
  try {
    if (!fs.existsSync(filePath)) {
      return null
    }
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function readNestedKey(obj: Record<string, unknown> | null, ...keys: string[]): string {
  let curr: unknown = obj
  for (const key of keys) {
    if (!curr || typeof curr !== 'object' || Array.isArray(curr)) {
      return ''
    }
    curr = (curr as Record<string, unknown>)[key]
  }
  return typeof curr === 'string' ? curr.trim() : ''
}

/**
 * Resolve Gemini API key strictly on desktop (never transmitted to mobile clients).
 */
export function resolveDesktopGeminiApiKey(): string {
  const envKey = (
    process.env.LIVE_GEMINI_API_KEY ||
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    ''
  ).trim()
  if (envKey) {
    return envKey
  }

  const home = os.homedir()
  const piAuth = readJsonFileSafe(path.join(home, '.pi', 'agent', 'auth.json'))
  const piLiveKey = readNestedKey(piAuth, 'Live', 'key')
  if (piLiveKey) {
    return piLiveKey
  }
  const piGoogleKey = readNestedKey(piAuth, 'google', 'key')
  if (piGoogleKey) {
    return piGoogleKey
  }

  const orcaVoiceCfg = readJsonFileSafe(path.join(home, '.orca', 'voice-bridge.json'))
  const orcaCfgKey = readNestedKey(orcaVoiceCfg, 'geminiApiKey')
  if (orcaCfgKey) {
    return orcaCfgKey
  }

  const bridgeDb = readJsonFileSafe(
    path.join(home, 'Code Base', 'voice-bridge-for-pi', 'data', 'bridge-db.json')
  )
  const bridgeKey = readNestedKey(bridgeDb, 'settings', 'geminiApiKey')
  if (bridgeKey) {
    return bridgeKey
  }

  return ''
}
