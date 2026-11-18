import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

export function getGitBranch(cwd: string): string {
  try {
    return execFileSync('git', ['-C', cwd, 'rev-parse', '--abbrev-ref', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2000
    }).trim()
  } catch {
    return 'no-git'
  }
}

export function getGitStatusSummary(cwd: string): string {
  try {
    const out = execFileSync('git', ['-C', cwd, 'status', '--short'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000
    }).trim()
    return out || 'Clean working tree.'
  } catch {
    return 'Not a git repository.'
  }
}

export function readWorkspaceTodos(cwd: string): string {
  const candidates = ['TODO.md', 'TASKS.md', 'INSTRUCTIONS.md', 'prompt-track.md']
  const found: string[] = []
  for (const name of candidates) {
    const full = path.join(cwd, name)
    if (fs.existsSync(full)) {
      try {
        found.push(`=== ${name} ===\n${fs.readFileSync(full, 'utf8').slice(0, 1500)}`)
      } catch {}
    }
  }
  return found.join('\n\n') || 'No TODO/TASKS file found.'
}
