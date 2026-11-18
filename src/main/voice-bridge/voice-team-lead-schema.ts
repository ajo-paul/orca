export const TEAM_LEAD_TOOLS = [
  {
    functionDeclarations: [
      {
        name: 'dispatch_to_pi',
        behavior: 'NON_BLOCKING',
        description:
          'Queue an asynchronous coding, debugging, file inspection, build, or test task for Pi. NEVER say work is done when calling dispatch_to_pi — only report results after [PI TEAM COMPLETED].',
        parameters: {
          type: 'OBJECT',
          properties: {
            prompt: { type: 'STRING', description: 'Self-contained instruction for Pi.' },
            shortTitle: { type: 'STRING', description: '3 to 6 word task title' }
          },
          required: ['prompt']
        }
      },
      {
        name: 'steer_pi',
        behavior: 'NON_BLOCKING',
        description: 'Send a live course-correction instruction into Pi while it is running.',
        parameters: {
          type: 'OBJECT',
          properties: { prompt: { type: 'STRING', description: 'Follow-up instruction.' } },
          required: ['prompt']
        }
      },
      {
        name: 'abort_pi',
        behavior: 'NON_BLOCKING',
        description: 'Abort the currently running Pi task.',
        parameters: { type: 'OBJECT', properties: {} }
      },
      {
        name: 'get_pi_status',
        behavior: 'NON_BLOCKING',
        description: 'Check whether Pi is idle or working, current tool, and modified files.',
        parameters: { type: 'OBJECT', properties: {} }
      },
      {
        name: 'read_workspace_todos',
        behavior: 'NON_BLOCKING',
        description: 'Read TODO.md / TASKS.md / prompt-track.md and git status.',
        parameters: { type: 'OBJECT', properties: {} }
      },
      {
        name: 'read_workspace_file',
        behavior: 'NON_BLOCKING',
        description: 'Read a text file in the workspace in chunks (offset/limit/hasMore).',
        parameters: {
          type: 'OBJECT',
          properties: {
            path: { type: 'STRING', description: 'Relative path (e.g. README.md)' },
            offset: { type: 'NUMBER', description: 'Character offset (default 0)' },
            limit: { type: 'NUMBER', description: 'Max characters (default 3500, max 4000)' }
          },
          required: ['path']
        }
      },
      {
        name: 'end_call',
        behavior: 'NON_BLOCKING',
        description: 'Hang up the call ONLY when the caller explicitly asks to end the call.',
        parameters: {
          type: 'OBJECT',
          properties: { reason: { type: 'STRING', description: 'Reason for ending call' } }
        }
      },
      {
        name: 'set_voice_mode',
        behavior: 'NON_BLOCKING',
        description: 'Switch voice collaboration mode: Scout, Ship, Review, or Pocket.',
        parameters: {
          type: 'OBJECT',
          properties: { mode: { type: 'STRING', description: 'Scout, Ship, Review, or Pocket' } },
          required: ['mode']
        }
      },
      {
        name: 'orca_list_worktrees',
        behavior: 'NON_BLOCKING',
        description: 'List repositories and git worktrees registered in Orca Desktop.',
        parameters: { type: 'OBJECT', properties: {} }
      },
      {
        name: 'orca_focus_workspace',
        behavior: 'NON_BLOCKING',
        description: 'Navigate Orca Desktop to a repository/worktree by name or path.',
        parameters: {
          type: 'OBJECT',
          properties: {
            query: { type: 'STRING', description: 'Repo/worktree name or path' },
            showDiff: { type: 'BOOLEAN', description: 'Open git diff view if true' }
          }
        }
      },
      {
        name: 'orca_focus',
        behavior: 'NON_BLOCKING',
        description:
          'Focus terminal, file, diff, browser (next/prev tab), or workspace on Orca Desktop.',
        parameters: {
          type: 'OBJECT',
          properties: {
            target: { type: 'STRING', description: 'terminal | file | diff | browser | workspace' },
            query: { type: 'STRING', description: 'Relative path, terminal name, or workspace' },
            direction: { type: 'STRING', description: 'next | prev when target=browser' },
            url: { type: 'STRING', description: 'URL when target=browser' }
          },
          required: ['target']
        }
      },
      {
        name: 'orca_open_browser',
        behavior: 'NON_BLOCKING',
        description: 'Open a URL in Orca embedded browser tab and bring it into view.',
        parameters: {
          type: 'OBJECT',
          properties: { url: { type: 'STRING', description: 'URL to open' } },
          required: ['url']
        }
      },
      {
        name: 'orca_list_harnesses',
        behavior: 'NON_BLOCKING',
        description: 'List coding agent harnesses supported by Orca Desktop.',
        parameters: { type: 'OBJECT', properties: {} }
      },
      {
        name: 'orca_launch_harness',
        behavior: 'NON_BLOCKING',
        description:
          'Launch an Orca coding agent harness (pi, claude, codex, opencode, gemini) in this worktree.',
        parameters: {
          type: 'OBJECT',
          properties: {
            harnessId: { type: 'STRING', description: 'Harness ID (e.g. claude, codex, pi)' },
            prompt: { type: 'STRING', description: 'Optional initial prompt' },
            title: { type: 'STRING', description: 'Optional terminal tab title' }
          },
          required: ['harnessId']
        }
      },
      {
        name: 'orca_list_terminals',
        behavior: 'NON_BLOCKING',
        description: 'List open Orca terminal tabs in this worktree.',
        parameters: { type: 'OBJECT', properties: {} }
      },
      {
        name: 'orca_read_terminal',
        behavior: 'NON_BLOCKING',
        description: 'Read recent lines from an Orca terminal tab.',
        parameters: {
          type: 'OBJECT',
          properties: {
            terminalHandle: { type: 'STRING', description: 'Terminal handle' },
            limit: { type: 'NUMBER', description: 'Lines to return (default 80)' }
          }
        }
      },
      {
        name: 'orca_send_to_terminal',
        behavior: 'NON_BLOCKING',
        description: 'Send text or command + Enter into an Orca terminal tab.',
        parameters: {
          type: 'OBJECT',
          properties: {
            terminalHandle: { type: 'STRING', description: 'Target terminal handle' },
            text: { type: 'STRING', description: 'Text/command to send' },
            pressEnter: { type: 'BOOLEAN', description: 'Press Enter (default true)' }
          },
          required: ['text']
        }
      }
    ]
  }
]
