// Demo chat for the web page: runs the exact WhatsApp conversation logic (lib/whatsapp.respond)
// and returns the replies plus the ops alert each ticket would trigger. Nothing is sent anywhere.
import { respond } from '../lib/whatsapp.js';
import { opsAlertText } from '../lib/escalation.js';
import { log } from '../lib/notify.js';

export async function POST(request) {
  let body;
  try { body = await request.json(); } catch { return Response.json({ error: 'invalid json' }, { status: 400 }); }
  const text = String(body.text || '').slice(0, 500);
  const replyId = body.replyId ? String(body.replyId).slice(0, 100) : null;
  const msg = replyId
    ? { id: 'web-' + Date.now(), from: '15550100101', type: 'interactive', replyId }
    : { id: 'web-' + Date.now(), from: '15550100101', type: 'text', text };
  const { replies, tickets } = respond(msg, { timezone: process.env.TIMEZONE || 'Africa/Lagos' });
  if (tickets.length) log('web_demo_escalation', { tickets: tickets.map((t) => t.ticket_id) });
  return Response.json({ replies, tickets: tickets.map((t) => ({ ticket_id: t.ticket_id, priority: t.priority, issue: t.issue_label, source: t.source, ops_alert: opsAlertText(t) })) });
}
