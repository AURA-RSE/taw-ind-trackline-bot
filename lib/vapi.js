// Vapi server messages: tool calls (lookup_shipment, report_problem) and end-of-call reports.
import { findShipment, describeShipment, normalizeTrackingNumber } from './shipments.js';
import { ISSUES, detectIssue, autoEscalationReason, buildTicket, customerTicketText, maskContact } from './escalation.js';

function args(raw) {
  if (raw && typeof raw === 'object') return raw;
  try { return JSON.parse(raw || '{}'); } catch { return null; }
}

function lookup(a, now, timezone, contact) {
  const found = findShipment(a.tracking_number, now);
  if (!found.ok) {
    const heard = normalizeTrackingNumber(a.tracking_number);
    return {
      result: { found: false, instruction: heard ? `No shipment ${heard.split('').join(' ')}. Read the number back to the caller and ask them to check it. It starts with T L and has 8 digits.` : 'That did not sound like a tracking number. Ask the caller to read it again slowly: T L then 8 digits.' },
      tickets: [],
    };
  }
  const s = found.shipment;
  const auto = autoEscalationReason(s, now);
  const tickets = [];
  let instruction = 'Read the status to the caller in one or two sentences. Ask if they need anything else.';
  let ticket = null;
  if (auto) {
    ticket = buildTicket({ shipment: s, issue: auto, source: 'auto', channel: 'voice', note: s.reason, contact }, now);
    tickets.push(ticket);
    instruction = `This shipment has a problem and was escalated automatically. Read the status, then say: ${customerTicketText(ticket)} Spell the reference slowly. Offer to transfer them to a person.`;
  } else if (s.exception) {
    instruction = 'Read the status, apologise, and offer to report a problem or transfer them to a person.';
  }
  return {
    result: { found: true, tracking: s.tracking, status: s.status, exception: s.exception, summary: describeShipment(s, { timezone, voice: true }), ticket_id: ticket ? ticket.ticket_id : null, instruction },
    tickets,
  };
}

function report(a, now, contact) {
  const issue = ISSUES[a.issue] ? a.issue : detectIssue(a.details) || 'human';
  const found = findShipment(a.tracking_number, now);
  if (!found.ok && issue !== 'human') {
    return { error: 'I need a valid tracking number to report this. Ask the caller for it (T L and 8 digits), then try again.', tickets: [] };
  }
  const t = buildTicket({ shipment: found.ok ? found.shipment : null, tracking: found.tracking, issue, source: 'customer', channel: 'voice', note: a.details, contact }, now);
  return { result: { ticket_id: t.ticket_id, priority: t.priority, instruction: `Say: ${customerTicketText(t)} Spell the reference slowly.` }, tickets: [t] };
}

export function handleVapiMessage(body, { now = new Date(), timezone = 'Africa/Lagos' } = {}) {
  const msg = (body && body.message) || {};
  const call = msg.call || {};
  const contact = (call.customer && call.customer.number) || '';

  if (msg.type === 'tool-calls') {
    const calls = msg.toolCallList || (msg.toolWithToolCallList || []).map((t) => t.toolCall);
    const results = [];
    const tickets = [];
    for (const tc of calls) {
      const fn = (tc && tc.function) || {};
      const a = args(fn.arguments);
      if (!a) { results.push({ toolCallId: tc.id, error: 'Arguments could not be read. Ask the caller to repeat.' }); continue; }
      let r;
      if (fn.name === 'lookup_shipment') r = lookup(a, now, timezone, contact);
      else if (fn.name === 'report_problem') r = report(a, now, contact);
      else r = { error: `Unknown tool ${fn.name}`, tickets: [] };
      tickets.push(...r.tickets);
      results.push(r.error ? { toolCallId: tc.id, error: r.error } : { toolCallId: tc.id, result: JSON.stringify(r.result) });
    }
    return { kind: 'tool-calls', response: { results }, tickets };
  }

  if (msg.type === 'end-of-call-report') {
    const sd = (msg.analysis && msg.analysis.structuredData) || {};
    return {
      kind: 'end-of-call-report',
      response: { ok: true },
      tickets: [],
      callLog: {
        call_id: call.id || '',
        caller: maskContact(contact),
        ended_reason: msg.endedReason || '',
        tracking: sd.tracking_number || '',
        outcome: sd.outcome || (msg.endedReason === 'assistant-forwarded-call' ? 'transferred' : ''),
        summary: String((msg.analysis && msg.analysis.summary) || '').slice(0, 500),
      },
    };
  }
  return { kind: msg.type || 'unknown', response: {}, tickets: [] };
}
