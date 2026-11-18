export const PI_VOICE_EXTENSION_SOURCE = `import net from 'node:net';
import fs from 'node:fs';

function extractAssistantSummary(messages) {
  if (!Array.isArray(messages)) return '';
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== 'assistant') continue;
    if (m?.errorMessage || m?.error) {
      return ('Pi Error: ' + (m.errorMessage || m.error)).slice(0, 2500);
    }
    const content = m.content;
    if (typeof content === 'string' && content.trim()) return content.trim().slice(0, 2500);
    if (Array.isArray(content)) {
      const txt = content
        .filter((b) => b?.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text)
        .join('\\n')
        .trim();
      if (txt) return txt.slice(0, 2500);
    }
  }
  return '';
}

export default function piVoiceExtension(pi) {
  const sockPath = process.env.PI_VOICE_SOCK;
  if (!sockPath) return;

  try { fs.rmSync(sockPath, { force: true }); } catch {}

  const clients = new Set();
  let activeCtx = null;
  let isStreaming = false;
  let lastAssistantText = '';

  const computeLiveIdle = () => {
    if (typeof activeCtx?.isIdle === 'function') {
      try { return Boolean(activeCtx.isIdle()); } catch {}
    }
    return !isStreaming;
  };

  const broadcast = (obj) => {
    const line = JSON.stringify(obj) + '\\n';
    for (const c of clients) {
      if (!c.destroyed) c.write(line);
    }
  };

  const server = net.createServer((socket) => {
    clients.add(socket);
    let buf = '';
    socket.on('data', async (chunk) => {
      buf += chunk.toString('utf8');
      const lines = buf.split('\\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        let cmd;
        try { cmd = JSON.parse(line); } catch { continue; }
        const respond = (success, data, error) => {
          if (!socket.destroyed) {
            socket.write(JSON.stringify({
              type: 'response',
              id: cmd.id,
              command: cmd.type,
              success,
              data,
              error
            }) + '\\n');
          }
        };
        try {
          if (cmd.type === 'prompt') {
            if (!activeCtx?.model) {
              throw new Error('No active LLM model selected in Pi.');
            }
            isStreaming = true;
            pi.sendUserMessage(String(cmd.message || ''));
            respond(true, { disposition: 'started' });
          } else if (cmd.type === 'steer') {
            pi.sendUserMessage(String(cmd.message || ''), { deliverAs: 'steer' });
            respond(true, { disposition: 'steered' });
          } else if (cmd.type === 'abort') {
            activeCtx?.abort?.();
            isStreaming = false;
            respond(true, { aborted: true });
          } else if (cmd.type === 'get_state') {
            const idle = computeLiveIdle();
            if (idle) isStreaming = false;
            respond(true, {
              sessionId: activeCtx?.sessionManager?.getSessionId?.() || '',
              sessionFile: activeCtx?.sessionManager?.getSessionFile?.() || '',
              isStreaming: !idle,
              isIdle: idle,
              lastAssistantText
            });
          } else {
            respond(false, undefined, 'Unknown command: ' + cmd.type);
          }
        } catch (err) {
          respond(false, undefined, err?.message || String(err));
        }
      }
    });
    socket.on('close', () => clients.delete(socket));
    socket.on('error', () => clients.delete(socket));
  });

  server.listen(sockPath, () => {
    try { fs.chmodSync(sockPath, 0o600); } catch {}
  });

  pi.on('session_start', async (_event, ctx) => {
    activeCtx = ctx;
    broadcast({
      type: 'session_start',
      sessionId: ctx?.sessionManager?.getSessionId?.() || '',
      sessionFile: ctx?.sessionManager?.getSessionFile?.() || ''
    });
  });

  pi.on('agent_start', async (_event, ctx) => {
    activeCtx = ctx;
    isStreaming = true;
    broadcast({ type: 'agent_start' });
  });

  pi.on('tool_execution_start', async (event, ctx) => {
    activeCtx = ctx;
    broadcast({
      type: 'tool_execution_start',
      toolName: event.toolName,
      args: event.args
    });
  });

  pi.on('message_update', async (event, ctx) => {
    activeCtx = ctx;
    if (event?.assistantMessageEvent?.type === 'text_delta' && event.assistantMessageEvent.delta) {
      broadcast({
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: event.assistantMessageEvent.delta }
      });
    }
  });

  pi.on('agent_end', async (event, ctx) => {
    activeCtx = ctx;
    isStreaming = false;
    const summary = extractAssistantSummary(event?.messages || []);
    if (summary) lastAssistantText = summary;
    broadcast({
      type: 'agent_end',
      messages: event?.messages || [],
      summary
    });
  });

  pi.on('session_shutdown', async () => {
    try { server.close(); } catch {}
    try { fs.rmSync(sockPath, { force: true }); } catch {}
  });
}
`
