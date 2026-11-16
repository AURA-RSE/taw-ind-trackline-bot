// Exception escalation: decides when a human must step in and builds the ticket + ops alert.
import { createHash } from 'node:crypto';

// Customer-reported problems, from WhatsApp text, list picks or voice.
export const ISSUES = {
  damaged: { short: 'Damaged', label: 'Parcel damaged', priority: 'high', patterns: [/damag/, /broken/, /smashed/, /crushed/, /torn/, /wet/] },
  not_received: { short: 'Not received', label: 'Marked delivered but not received', priority: 'high', patterns: [/not (been )?received/, /never (got|arrived|came)/, /didn'?t (get|receive)/, /did not (get|receive)/, /missing/, /stolen/, /lost/] },
  wrong_item: { short: 'Wrong item', label: 'Wrong item delivered', priority: 'medium', patterns: [/wrong (item|parcel|package|order)/, /not (what|the thing) i ordered/] },
  late: { short: 'Late', label: 'Delivery is late', priority: 'medium', patterns: [/late/, /delay/, /taking (too|so) long/, /still (hasn'?t|not) (come|arrived)/, /where is it/] },
  reschedule: { short: 'Reschedule', label: 'Reschedule or change address', priority: 'low', patterns: [/reschedul/, /change (the )?(address|date|time)/, /deliver (it )?(tomorrow|another day|later)/, /redeliver/] },
  human: { short: 'Agent', label: 'Customer asked for a person', priority: 'medium', patterns: [/human/, /agent/, /real person/, /speak to (someone|somebody)/, /talk to (someone|somebody|a person)/, /customer (care|service)/, /complain/] },
};

export function detectIssue(text) {
  const t = String(text || '').toLowerCase().replace(/[’`]/g, "'");
  for (const [key, def] of Object.entries(ISSUES)) if (def.patterns.some((p) => p.test(t))) return key;
  return null;
}

// Statuses that escalate automatically on lookup, without the customer asking.
const AUTO = {
  delayed: (s, now) => now - new Date(s.lastScanAt) > 48 * 3600 * 1000, // no scan for 48h+
  failed_attempt: (s) => s.attempts >= 2,
  held_at_hub: () => true,
  damaged: () => true,
};

export function autoEscalationReason(shipment, now = new Date()) {
  const rule = AUTO[shipment.status];
  return rule && rule(shipment, now) ? shipment.status : null;
}

function priorityFor(issueKey, shipment) {
  const base = (ISSUES[issueKey] && ISSUES[issueKey].priority) || { damaged: 'high', held_at_hub: 'high', failed_attempt: 'medium', delayed: 'medium' }[issueKey] || 'medium';
  if (shipment && shipment.highValue && base !== 'high') return 'high';
  return base;
}

// Deterministic ticket ID: the same shipment + issue on the same day gives the same ticket,
// so a webhook retry or a customer asking twice doesn't open duplicates.
export function ticketId(tracking, issueKey, now = new Date(), timezone = 'Africa/Lagos') {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now).replace(/-/g, '');
  const h = createHash('sha256').update(`${tracking}|${issueKey}|${day}`).digest('hex').slice(0, 4).toUpperCase();
  return `ESC-${day}-${h}`;
}

export function buildTicket({ shipment, tracking, issue, source, channel, note, contact }, now = new Date()) {
  const id = (shipment && shipment.tracking) || tracking || 'UNKNOWN';
  return {
    ticket_id: ticketId(id, issue, now),
    tracking: id,
    issue,
    issue_label: (ISSUES[issue] && ISSUES[issue].label) || (shipment ? shipment.statusLabel : issue),
    priority: priorityFor(issue, shipment),
    source, // 'customer' | 'auto'
    channel, // 'whatsapp' | 'voice' | 'web'
    status_at_escalation: shipment ? shipment.status : 'unknown',
    note: note ? String(note).slice(0, 300) : '',
    contact: contact || '',
    created_at: now.toISOString(),
  };
}

export function maskContact(c) {
  const s = String(c || '');
  return s.length > 4 ? s.slice(0, -4).replace(/[0-9]/g, '•') + s.slice(-4) : s;
}

// Message to the ops team. Contains the customer's number (masked) only; ops look up the rest internally.
export function opsAlertText(t) {
  const flag = t.priority === 'high' ? '🔴' : t.priority === 'medium' ? '🟠' : '🟢';
  return [
    `${flag} TrackLine escalation ${t.ticket_id}`,
    `Shipment: ${t.tracking} (${t.status_at_escalation})`,
    `Issue: ${t.issue_label} · Priority: ${t.priority}`,
    `Via: ${t.channel}${t.source === 'auto' ? ' (automatic)' : ''}${t.contact ? ' · Customer: ' + maskContact(t.contact) : ''}`,
    t.note ? `Note: ${t.note}` : null,
  ].filter(Boolean).join('\n');
}

export function customerTicketText(t) {
  const when = t.priority === 'high' ? 'within 2 hours' : t.priority === 'medium' ? 'within 1 working day' : 'within 2 working days';
  return `I've passed this to our support team. Your reference is ${t.ticket_id} (${t.issue_label.toLowerCase()}). Someone will contact you ${when}.`;
}
