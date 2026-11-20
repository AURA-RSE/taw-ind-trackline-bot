// WhatsApp Cloud API webhook. GET = Meta's verification handshake, POST = inbound messages.
import { loadConfig, whatsappReady } from '../lib/config.js';
import { verifySignature, parseWebhook, respond, sendWithFallback } from '../lib/whatsapp.js';
import { raiseTickets, log } from '../lib/notify.js';

const seen = new Set(); // best-effort dedupe of Meta's webhook retries (per warm instance)
const remember = (id) => { seen.add(id); if (seen.size > 500) seen.delete(seen.values().next().value); };

export async function GET(request) {
  const cfg = loadConfig();
  const p = new URL(request.url).searchParams;
  if (p.get('hub.mode') === 'subscribe' && cfg.whatsapp.verifyToken && p.get('hub.verify_token') === cfg.whatsapp.verifyToken) {
    return new Response(p.get('hub.challenge') || '', { status: 200 });
  }
  return new Response('Forbidden', { status: 403 });
}

export async function POST(request, deps = {}) {
  const cfg = deps.cfg || loadConfig();
  const raw = await request.text();
  if (!verifySignature(raw, request.headers.get('x-hub-signature-256'), cfg.whatsapp.appSecret)) {
    log('whatsapp_bad_signature', {});
    return new Response('Invalid signature', { status: 401 });
  }
  let body;
  try { body = JSON.parse(raw); } catch { return new Response('ok', { status: 200 }); }

  const sent = [];
  for (const msg of parseWebhook(body)) {
    if (seen.has(msg.id)) continue;
    remember(msg.id);
    try {
      const { replies, tickets } = respond(msg, { timezone: cfg.timezone });
      if (whatsappReady(cfg)) {
        for (const r of replies) sent.push(await sendWithFallback(cfg.whatsapp, msg.from, r, deps.sendOpts));
      }
      await raiseTickets(cfg, tickets, deps.sendOpts);
      log('whatsapp_message', { type: msg.type, replies: replies.length, tickets: tickets.map((t) => t.ticket_id), delivered: sent.filter((s) => s && s.ok).length });
    } catch (e) {
      // Always 200 to Meta, otherwise it retries the same message for hours.
      log('whatsapp_handler_error', { error: String(e && e.message) });
    }
  }
  return new Response('ok', { status: 200 });
}
