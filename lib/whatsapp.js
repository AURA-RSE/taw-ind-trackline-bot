// WhatsApp Cloud API: webhook parsing, signature check, conversation logic and sending.
// The conversation is stateless: button and list IDs carry the tracking number,
// so it works on serverless hosts with no session store.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { findShipment, extractTrackingNumber, describeShipment } from './shipments.js';
import { ISSUES, detectIssue, autoEscalationReason, buildTicket, customerTicketText } from './escalation.js';

export function verifySignature(rawBody, header, appSecret) {
  if (!appSecret) return true; // optional in development; set WHATSAPP_APP_SECRET in production
  if (!header || !header.startsWith('sha256=')) return false;
  const expected = Buffer.from('sha256=' + createHmac('sha256', appSecret).update(rawBody).digest('hex'));
  const given = Buffer.from(header);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

// Flattens Meta's nested webhook into the inbound messages we care about.
export function parseWebhook(body) {
  const out = [];
  for (const entry of (body && body.entry) || []) {
    for (const change of entry.changes || []) {
      const v = change.value || {};
      for (const m of v.messages || []) {
        const base = { id: m.id, from: m.from, timestamp: m.timestamp, type: m.type };
        if (m.type === 'text') out.push({ ...base, text: m.text && m.text.body });
        else if (m.type === 'interactive') {
          const r = m.interactive && (m.interactive.button_reply || m.interactive.list_reply);
          out.push({ ...base, replyId: r && r.id, replyTitle: r && r.title });
        } else if (m.type === 'button') out.push({ ...base, text: m.button && m.button.text });
        else out.push(base);
      }
    }
  }
  return out;
}

const text = (body) => ({ type: 'text', text: { body, preview_url: false } });
const buttons = (body, btns) => ({
  type: 'interactive',
  interactive: { type: 'button', body: { text: body }, action: { buttons: btns.map(([id, title]) => ({ type: 'reply', reply: { id, title } })) } },
});
const issueList = (tracking) => ({
  type: 'interactive',
  interactive: {
    type: 'list',
    body: { text: `What's wrong with ${tracking}?` },
    action: {
      button: 'Choose a problem',
      sections: [{ title: 'Problem', rows: ['damaged', 'not_received', 'wrong_item', 'late', 'reschedule'].map((k) => ({ id: `issue|${k}|${tracking}`, title: ISSUES[k].short, description: ISSUES[k].label })) }],
    },
  },
});

export const WELCOME = "Hi, I'm the TrackLine delivery assistant 📦. Send me your tracking number (it looks like TL20481736) and I'll tell you where your parcel is. You can also tell me about a problem, e.g. \"TL20481736 arrived damaged\".";

// Pure decision function: inbound message -> replies to send + tickets to raise.
export function respond(msg, { now = new Date(), timezone = 'Africa/Lagos' } = {}) {
  const replies = [];
  const tickets = [];
  const escalate = (shipment, issue, source, note) => {
    const t = buildTicket({ shipment, issue, source, channel: 'whatsapp', note, contact: msg.from }, now);
    tickets.push(t);
    return t;
  };

  if (msg.type === 'interactive' && msg.replyId) {
    const [kind, a, b] = msg.replyId.split('|');
    if (kind === 'report') {
      replies.push(issueList(a));
    } else if (kind === 'issue' || kind === 'human') {
      const issue = kind === 'human' ? 'human' : a;
      const tracking = kind === 'human' ? a : b;
      const found = findShipment(tracking, now);
      const t = escalate(found.ok ? found.shipment : null, ISSUES[issue] ? issue : 'human', 'customer');
      replies.push(text(customerTicketText(t)));
    } else {
      replies.push(text(WELCOME));
    }
    return { replies, tickets };
  }

  if (msg.type !== 'text' && msg.type !== 'button') {
    replies.push(text("I can only read text messages for now. Please type your tracking number, e.g. TL20481736."));
    return { replies, tickets };
  }

  const body = String(msg.text || '').trim();
  const tracking = extractTrackingNumber(body);
  const issue = detectIssue(body);

  if (!tracking) {
    replies.push(text(issue ? 'Sorry to hear that. Please send your tracking number with the problem, e.g. "TL20481736 arrived damaged", and I will raise it with our team.' : WELCOME));
    return { replies, tickets };
  }

  const found = findShipment(tracking, now);
  if (!found.ok) {
    replies.push(text(`I couldn't find ${found.tracking || tracking}. Please check the number on your receipt or SMS. It starts with TL and has 8 digits.`));
    return { replies, tickets };
  }
  const s = found.shipment;
  const status = describeShipment(s, { timezone });

  if (!issue && /\b(problem|issue|report)\b/i.test(body)) {
    replies.push(issueList(s.tracking));
    return { replies, tickets };
  }

  if (issue && issue !== 'late') {
    const t = escalate(s, issue, 'customer', body);
    replies.push(text(`${status}\n\n${customerTicketText(t)}`));
    return { replies, tickets };
  }

  const auto = autoEscalationReason(s, now);
  if (auto || issue === 'late') {
    const t = escalate(s, auto || 'late', auto ? 'auto' : 'customer', auto ? s.reason : body);
    replies.push(text(`${status}\n\nI've already alerted our support team (ref ${t.ticket_id}). They'll contact you ${t.priority === 'high' ? 'within 2 hours' : 'within 1 working day'}.`));
    return { replies, tickets };
  }

  replies.push(buttons(status, [[`report|${s.tracking}`, 'Report a problem'], [`human|${s.tracking}`, 'Talk to a person']]));
  return { replies, tickets };
}

// Sends one message with retries on rate limits, server errors and network failures.
export async function sendWhatsApp(cfg, to, payload, { fetchImpl = fetch, retries = 3, baseDelayMs = 500 } = {}) {
  const url = `https://graph.facebook.com/${cfg.graphVersion}/${cfg.phoneNumberId}/messages`;
  const body = JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to, ...payload });
  let last = null;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetchImpl(url, { method: 'POST', headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' }, body });
      if (res.ok) return { ok: true, status: res.status, attempts: attempt };
      const errBody = await res.text().catch(() => '');
      last = { ok: false, status: res.status, error: errBody.slice(0, 300), attempts: attempt };
      if (res.status !== 429 && res.status < 500) return last; // 4xx won't fix itself
    } catch (e) {
      last = { ok: false, status: 0, error: String(e && e.message), attempts: attempt };
    }
    if (attempt < retries) await new Promise((r) => setTimeout(r, baseDelayMs * 2 ** (attempt - 1)));
  }
  return last;
}

// Interactive messages can be rejected (old clients, API changes): fall back to plain text.
export async function sendWithFallback(cfg, to, payload, opts) {
  const r = await sendWhatsApp(cfg, to, payload, opts);
  if (r.ok || payload.type !== 'interactive') return r;
  const i = payload.interactive;
  const fallback = i.type === 'list' ? `${i.body.text} Reply with the problem in words, e.g. "${i.action.sections[0].rows[0].id.split('|')[2]} arrived damaged".` : `${i.body.text}\n\nReply "problem" with your tracking number to report an issue, or "agent" to talk to a person.`;
  return sendWhatsApp(cfg, to, text(fallback), opts);
}

// Plain-text version of a reply, for channels without buttons (Twilio sandbox, fallbacks).
export function toPlainText(payload) {
  if (payload.type === 'text') return payload.text.body;
  const i = payload.interactive;
  if (i.type === 'button') {
    const id = i.action.buttons[0].reply.id.split('|')[1];
    return `${i.body.text}\n\nReply "${id} problem" to report an issue, or "${id} agent" to talk to a person.`;
  }
  const id = i.action.sections[0].rows[0].id.split('|')[2];
  return `${i.body.text} Reply with one of these:\n` + i.action.sections[0].rows.map((r) => `• ${id} ${r.title.toLowerCase()}`).join('\n');
}
