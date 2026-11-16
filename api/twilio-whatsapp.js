// Twilio WhatsApp (sandbox or approved sender) webhook: same conversation as the Meta Cloud API route.
// Replies are returned as TwiML in the HTTP response, so no outbound API call is needed for replies.
// Twilio has no reply buttons in the sandbox, so interactive messages become numbered text menus.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { loadConfig } from '../lib/config.js';
import { respond, toPlainText } from '../lib/whatsapp.js';
import { raiseTickets, log } from '../lib/notify.js';

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const twiml = (messages) => `<?xml version="1.0" encoding="UTF-8"?><Response>${messages.map((m) => `<Message>${xml(m)}</Message>`).join('')}</Response>`;

// https://www.twilio.com/docs/usage/security#validating-requests
export function validTwilioSignature(authToken, url, params, header) {
  if (!authToken) return true; // optional in development
  if (!header) return false;
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join('');
  const expected = Buffer.from(createHmac('sha1', authToken).update(data).digest('base64'));
  const given = Buffer.from(header);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export async function POST(request, deps = {}) {
  const cfg = deps.cfg || loadConfig();
  const raw = await request.text();
  const params = Object.fromEntries(new URLSearchParams(raw));
  const publicUrl = cfg.publicBaseUrl ? cfg.publicBaseUrl.replace(/\/$/, '') + new URL(request.url).pathname : request.url;
  if (!validTwilioSignature(cfg.twilio.authToken, publicUrl, params, request.headers.get('x-twilio-signature'))) {
    log('twilio_bad_signature', {});
    return new Response('Invalid signature', { status: 401 });
  }
  const from = String(params.From || '').replace(/^whatsapp:/, '').replace(/^\+/, '');
  const msg = Number(params.NumMedia || 0) > 0 && !params.Body
    ? { id: params.MessageSid, from, type: 'image' }
    : { id: params.MessageSid, from, type: 'text', text: params.Body || '' };
  let texts = ['Sorry, something went wrong on our side. Please try again in a minute.'];
  try {
    const { replies, tickets } = respond(msg, { timezone: cfg.timezone });
    texts = replies.map(toPlainText);
    await raiseTickets(cfg, tickets, deps.sendOpts);
    log('twilio_whatsapp_message', { replies: texts.length, tickets: tickets.map((t) => t.ticket_id) });
  } catch (e) {
    log('twilio_handler_error', { error: String(e && e.message) });
  }
  return new Response(twiml(texts), { status: 200, headers: { 'content-type': 'text/xml' } });
}
