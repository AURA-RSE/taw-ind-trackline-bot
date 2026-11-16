// Vapi server URL: tool calls and end-of-call reports for the voice assistant.
import { loadConfig } from '../lib/config.js';
import { handleVapiMessage } from '../lib/vapi.js';
import { raiseTickets, log } from '../lib/notify.js';

export async function POST(request, deps = {}) {
  const cfg = deps.cfg || loadConfig();
  const presented = request.headers.get('x-vapi-secret') || String(request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (cfg.vapiSecret && presented !== cfg.vapiSecret) return Response.json({ error: 'unauthorized' }, { status: 401 });
  let body;
  try { body = await request.json(); } catch { return Response.json({ error: 'invalid json' }, { status: 400 }); }
  const out = handleVapiMessage(body, { timezone: cfg.timezone });
  if (out.tickets.length) await raiseTickets(cfg, out.tickets, deps.sendOpts);
  if (out.callLog) log('voice_call', out.callLog);
  // Vapi requires HTTP 200 even when a tool fails (errors travel in the `error` field).
  return Response.json(out.response, { status: 200 });
}
