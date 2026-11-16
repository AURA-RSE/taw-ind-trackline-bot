// Run: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { normalizeTrackingNumber, extractTrackingNumber, findShipment, describeShipment, allTrackingNumbers } from '../lib/shipments.js';
import { detectIssue, autoEscalationReason, buildTicket, ticketId, opsAlertText } from '../lib/escalation.js';
import { parseWebhook, respond, verifySignature, sendWhatsApp, sendWithFallback } from '../lib/whatsapp.js';
import { handleVapiMessage } from '../lib/vapi.js';
import * as waRoute from '../api/whatsapp.js';
import * as vapiRoute from '../api/vapi.js';
import * as trackRoute from '../api/track.js';

const NOW = new Date('2026-11-16T13:00:00Z');
const waText = (body, id = 'wamid.' + Math.random()) => ({ entry: [{ changes: [{ value: { messages: [{ id, from: '15550100101', timestamp: '1', type: 'text', text: { body } }] } }] }] });
const msg = (text) => ({ id: 'm', from: '15550100101', type: 'text', text });
const tool = (name, a, id = 'tc1') => ({ message: { type: 'tool-calls', call: { id: 'call1', customer: { number: '+15550100101' } }, toolCallList: [{ id, function: { name, arguments: a } }] } });
const silent = () => {}; // keep test output clean
console.log = silent;

test('tracking numbers: typed, spoken and messy', () => {
  assert.equal(normalizeTrackingNumber('TL20481736'), 'TL20481736');
  assert.equal(normalizeTrackingNumber('tl-2048 1736'), 'TL20481736');
  assert.equal(normalizeTrackingNumber('T L two zero four eight one seven three six'), 'TL20481736');
  assert.equal(normalizeTrackingNumber('tee el 2048 1736'), 'TL20481736');
  assert.equal(normalizeTrackingNumber('T L two oh four eight one seven three six'), 'TL20481736');
  assert.equal(normalizeTrackingNumber('T L 2 0 4 8 1 7 double three'), 'TL20481733');
  assert.equal(normalizeTrackingNumber('20481736'), 'TL20481736');
  assert.equal(normalizeTrackingNumber('hello'), null);
  assert.equal(extractTrackingNumber('where is my parcel TL 2048-1736 pls'), 'TL20481736');
  assert.equal(extractTrackingNumber('no number here'), null);
});

test('lookup: found, not found, invalid', () => {
  assert.equal(findShipment('TL20481736', NOW).shipment.status, 'in_transit');
  assert.deepEqual(findShipment('TL99999999', NOW), { ok: false, error: 'not_found', tracking: 'TL99999999' });
  assert.equal(findShipment('abc', NOW).error, 'invalid_format');
  assert.equal(allTrackingNumbers().length, 8);
});

test('status text never leaks personal data and has a line for every status', () => {
  for (const id of allTrackingNumbers()) {
    const s = findShipment(id, NOW).shipment;
    const line = describeShipment(s);
    assert.ok(line && line.includes(id), id);
    assert.doesNotMatch(line, /\+?\d{10,}|street|road \d/i);
  }
  assert.match(describeShipment(findShipment('TL20481736', NOW).shipment, { voice: true }), /T L 2 0 4 8/);
});

test('issue detection', () => {
  assert.equal(detectIssue('my parcel arrived damaged'), 'damaged');
  assert.equal(detectIssue("it says delivered but I didn't receive it"), 'not_received');
  assert.equal(detectIssue('you sent the wrong item'), 'wrong_item');
  assert.equal(detectIssue('can I talk to a real person'), 'human');
  assert.equal(detectIssue('please reschedule to tomorrow'), 'reschedule');
  assert.equal(detectIssue('where is TL20481736'), null);
});

test('automatic escalation rules', () => {
  const s = (id) => findShipment(id, NOW).shipment;
  assert.equal(autoEscalationReason(s('TL20481736'), NOW), null); // in transit
  assert.equal(autoEscalationReason(s('TL20481739'), NOW), 'delayed'); // no scan for 60h
  assert.equal(autoEscalationReason(s('TL20481740'), NOW), 'failed_attempt'); // 2 failed attempts
  assert.equal(autoEscalationReason(s('TL20481741'), NOW), 'held_at_hub');
  assert.equal(autoEscalationReason(s('TL20481742'), NOW), 'damaged');
});

test('tickets: deterministic IDs, priority bump for high-value, ops alert masks the number', () => {
  assert.equal(ticketId('TL1', 'damaged', NOW), ticketId('TL1', 'damaged', NOW));
  assert.notEqual(ticketId('TL1', 'damaged', NOW), ticketId('TL1', 'late', NOW));
  const held = buildTicket({ shipment: findShipment('TL20481741', NOW).shipment, issue: 'reschedule', source: 'customer', channel: 'whatsapp', contact: '15550100101' }, NOW);
  assert.equal(held.priority, 'high'); // low-priority issue, but a ₦250k parcel
  assert.match(held.ticket_id, /^ESC-20261116-[0-9A-F]{4}$/);
  const alert = opsAlertText(held);
  assert.match(alert, /•+0101/);
  assert.doesNotMatch(alert, /15550100101/);
});

test('WhatsApp: welcome, lookup with buttons, not found, unsupported media', () => {
  assert.match(respond(msg('hi'), { now: NOW }).replies[0].text.body, /tracking number/);
  const r = respond(msg('TL20481736'), { now: NOW });
  assert.equal(r.replies[0].type, 'interactive');
  assert.deepEqual(r.replies[0].interactive.action.buttons.map((b) => b.reply.id), ['report|TL20481736', 'human|TL20481736']);
  assert.equal(r.tickets.length, 0);
  assert.match(respond(msg('TL11112222'), { now: NOW }).replies[0].text.body, /couldn't find TL11112222/);
  assert.match(respond({ id: 'x', from: '1', type: 'image' }, { now: NOW }).replies[0].text.body, /only read text/);
});

test('WhatsApp: exceptions escalate automatically; customer problems open a ticket', () => {
  const auto = respond(msg('TL20481742'), { now: NOW });
  assert.equal(auto.tickets[0].source, 'auto');
  assert.match(auto.replies[0].text.body, /alerted our support team \(ref ESC-/);
  const cust = respond(msg('TL20481738 says delivered but I never got it'), { now: NOW });
  assert.equal(cust.tickets[0].issue, 'not_received');
  assert.equal(cust.tickets[0].priority, 'high');
  const noId = respond(msg('my parcel is damaged'), { now: NOW });
  assert.equal(noId.tickets.length, 0);
  assert.match(noId.replies[0].text.body, /send your tracking number/);
});

test('WhatsApp: buttons and list replies drive escalation without stored state', () => {
  const list = respond({ id: 'a', from: '1', type: 'interactive', replyId: 'report|TL20481736' }, { now: NOW });
  assert.equal(list.replies[0].interactive.type, 'list');
  const pick = respond({ id: 'b', from: '1', type: 'interactive', replyId: 'issue|wrong_item|TL20481736' }, { now: NOW });
  assert.equal(pick.tickets[0].issue, 'wrong_item');
  const human = respond({ id: 'c', from: '1', type: 'interactive', replyId: 'human|TL20481737' }, { now: NOW });
  assert.equal(human.tickets[0].issue, 'human');
});

test('webhook parsing and signature check', () => {
  const parsed = parseWebhook(waText('TL20481736', 'wamid.1'));
  assert.deepEqual(parsed[0], { id: 'wamid.1', from: '15550100101', timestamp: '1', type: 'text', text: 'TL20481736' });
  assert.deepEqual(parseWebhook({ entry: [{ changes: [{ value: { statuses: [{}] } }] }] }), []);
  const raw = '{"a":1}';
  const sig = 'sha256=' + createHmac('sha256', 's3cret').update(raw).digest('hex');
  assert.equal(verifySignature(raw, sig, 's3cret'), true);
  assert.equal(verifySignature(raw, sig, 'other'), false);
  assert.equal(verifySignature(raw, undefined, 's3cret'), false);
});

test('sending: retries 5xx, gives up on 4xx, falls back to text when interactive is rejected', async () => {
  const cfg = { token: 't', phoneNumberId: '1', graphVersion: 'v21.0' };
  let calls = 0;
  const flaky = async () => (++calls < 3 ? new Response('busy', { status: 503 }) : new Response('{}', { status: 200 }));
  assert.deepEqual(await sendWhatsApp(cfg, '1', { type: 'text', text: { body: 'x' } }, { fetchImpl: flaky, baseDelayMs: 1 }), { ok: true, status: 200, attempts: 3 });
  calls = 0;
  const bad = async () => { calls++; return new Response('bad', { status: 400 }); };
  assert.equal((await sendWhatsApp(cfg, '1', { type: 'text', text: { body: 'x' } }, { fetchImpl: bad, baseDelayMs: 1 })).attempts, 1);
  const bodies = [];
  const rejectInteractive = async (u, o) => { const b = JSON.parse(o.body); bodies.push(b.type); return new Response('{}', { status: b.type === 'interactive' ? 400 : 200 }); };
  const r = await sendWithFallback(cfg, '1', respond(msg('TL20481736'), { now: NOW }).replies[0], { fetchImpl: rejectInteractive, baseDelayMs: 1 });
  assert.equal(r.ok, true);
  assert.deepEqual(bodies, ['interactive', 'text']);
  const down = async () => { throw new Error('ECONNRESET'); };
  assert.equal((await sendWhatsApp(cfg, '1', { type: 'text', text: { body: 'x' } }, { fetchImpl: down, baseDelayMs: 1 })).ok, false);
});

test('Vapi: lookup, auto-escalation, report_problem, bad args', () => {
  const ok = handleVapiMessage(tool('lookup_shipment', { tracking_number: 'T L two zero four eight one seven three six' }), { now: NOW });
  const r = JSON.parse(ok.response.results[0].result);
  assert.equal(r.status, 'in_transit');
  assert.equal(ok.tickets.length, 0);
  const auto = handleVapiMessage(tool('lookup_shipment', '{"tracking_number":"TL20481741"}'), { now: NOW });
  assert.match(JSON.parse(auto.response.results[0].result).ticket_id, /^ESC-/);
  assert.equal(auto.tickets[0].channel, 'voice');
  const missing = handleVapiMessage(tool('lookup_shipment', { tracking_number: 'TL12345678' }), { now: NOW });
  assert.equal(JSON.parse(missing.response.results[0].result).found, false);
  const rep = handleVapiMessage(tool('report_problem', { tracking_number: 'TL20481738', issue: 'not_received', details: 'neighbour does not have it' }), { now: NOW });
  assert.equal(rep.tickets[0].priority, 'high');
  const noId = handleVapiMessage(tool('report_problem', { tracking_number: 'nope', issue: 'damaged' }), { now: NOW });
  assert.ok(noId.response.results[0].error);
  const junk = handleVapiMessage(tool('lookup_shipment', '{broken'), { now: NOW });
  assert.ok(junk.response.results[0].error);
  const unknown = handleVapiMessage(tool('delete_all', {}), { now: NOW });
  assert.ok(unknown.response.results[0].error);
});

test('Vapi: end-of-call report becomes a masked log row', () => {
  const out = handleVapiMessage({ message: { type: 'end-of-call-report', endedReason: 'customer-ended-call', analysis: { summary: 'Asked about TL20481736', structuredData: { tracking_number: 'TL20481736', outcome: 'status_given' } }, call: { id: 'c9', customer: { number: '+15550100101' } } } });
  assert.equal(out.callLog.caller, '+•••••••0101');
  assert.equal(out.callLog.outcome, 'status_given');
});

test('HTTP: WhatsApp verify handshake', async () => {
  process.env.WHATSAPP_VERIFY_TOKEN = 'vt';
  const ok = await waRoute.GET(new Request('https://x/api/whatsapp?hub.mode=subscribe&hub.verify_token=vt&hub.challenge=42'));
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), '42');
  assert.equal((await waRoute.GET(new Request('https://x/api/whatsapp?hub.mode=subscribe&hub.verify_token=no&hub.challenge=42'))).status, 403);
});

test('HTTP: WhatsApp POST sends replies + ops alert, dedupes retries, rejects bad signatures', async () => {
  const sentTo = [];
  const fetchImpl = async (u, o) => { sentTo.push(JSON.parse(o.body).to); return new Response('{}', { status: 200 }); };
  const cfg = { timezone: 'Africa/Lagos', whatsapp: { token: 't', phoneNumberId: '1', graphVersion: 'v21.0', appSecret: 'app' }, opsWhatsapp: '15550100199', vapiSecret: '' };
  const raw = JSON.stringify(waText('TL20481742', 'wamid.dup'));
  const sig = 'sha256=' + createHmac('sha256', 'app').update(raw).digest('hex');
  const req = () => new Request('https://x/api/whatsapp', { method: 'POST', body: raw, headers: { 'x-hub-signature-256': sig } });
  assert.equal((await waRoute.POST(req(), { cfg, sendOpts: { fetchImpl, baseDelayMs: 1 } })).status, 200);
  assert.deepEqual(sentTo, ['15550100101', '15550100199']); // customer reply, then ops alert
  await waRoute.POST(req(), { cfg, sendOpts: { fetchImpl, baseDelayMs: 1 } });
  assert.equal(sentTo.length, 2); // Meta retry ignored
  const bad = await waRoute.POST(new Request('https://x/api/whatsapp', { method: 'POST', body: raw, headers: { 'x-hub-signature-256': 'sha256=00' } }), { cfg });
  assert.equal(bad.status, 401);
});

test('HTTP: Vapi secret, JSON errors and the public demo lookup', async () => {
  const cfg = { timezone: 'Africa/Lagos', whatsapp: {}, opsWhatsapp: '', vapiSecret: 'sec' };
  const body = JSON.stringify(tool('lookup_shipment', { tracking_number: 'TL20481737' }));
  assert.equal((await vapiRoute.POST(new Request('https://x', { method: 'POST', body }), { cfg })).status, 401);
  const ok = await vapiRoute.POST(new Request('https://x', { method: 'POST', body, headers: { 'x-vapi-secret': 'sec' } }), { cfg });
  assert.equal(JSON.parse((await ok.json()).results[0].result).status, 'out_for_delivery');
  assert.equal((await vapiRoute.POST(new Request('https://x', { method: 'POST', body: '{', headers: { 'x-vapi-secret': 'sec' } }), { cfg })).status, 400);
  const t = await trackRoute.GET(new Request('https://x/api/track?id=tl20481739'));
  assert.equal((await t.json()).escalates, true);
  assert.equal((await trackRoute.GET(new Request('https://x/api/track?id=TL00000000'))).status, 404);
});

import * as twRoute from '../api/twilio-whatsapp.js';
import { toPlainText } from '../lib/whatsapp.js';

test('plain-text menus for channels without buttons, and "TL… problem" opens the menu', () => {
  const status = toPlainText(respond(msg('TL20481736'), { now: NOW }).replies[0]);
  assert.match(status, /Reply "TL20481736 problem"/);
  const menu = respond(msg('TL20481736 problem'), { now: NOW });
  assert.equal(menu.replies[0].interactive.type, 'list');
  const text = toPlainText(menu.replies[0]);
  assert.match(text, /• TL20481736 not received/);
  // every menu line, sent back as-is, opens the right ticket
  for (const [line, issue] of [['TL20481736 damaged', 'damaged'], ['TL20481736 not received', 'not_received'], ['TL20481736 wrong item', 'wrong_item'], ['TL20481736 late', 'late'], ['TL20481736 reschedule', 'reschedule'], ['TL20481736 agent', 'human']]) {
    assert.equal(respond(msg(line), { now: NOW }).tickets[0].issue, issue, line);
  }
});

test('Twilio route: TwiML reply, signature check, ops alert via Twilio', async () => {
  const { createHmac: h } = await import('node:crypto');
  const sent = [];
  const fetchImpl = async (u, o) => { sent.push([u, Object.fromEntries(new URLSearchParams(o.body.toString()))]); return new Response('{}', { status: 201 }); };
  const cfg = { timezone: 'Africa/Lagos', whatsapp: {}, opsWhatsapp: '15550100199', vapiSecret: '', publicBaseUrl: 'https://bot.example', twilio: { accountSid: 'AC1', authToken: 'tok', from: '+14155238886' } };
  const params = { MessageSid: 'SM1', From: 'whatsapp:+15550100101', Body: 'TL20481742', NumMedia: '0' };
  const sig = h('sha1', 'tok').update('https://bot.example/api/twilio-whatsapp' + Object.keys(params).sort().map((k) => k + params[k]).join('')).digest('base64');
  const req = (s) => new Request('https://internal/api/twilio-whatsapp', { method: 'POST', body: new URLSearchParams(params).toString(), headers: { 'x-twilio-signature': s, 'content-type': 'application/x-www-form-urlencoded' } });
  const res = await twRoute.POST(req(sig), { cfg, sendOpts: { fetchImpl, baseDelayMs: 1 } });
  const body = await res.text();
  assert.equal(res.status, 200);
  assert.match(body, /^<\?xml.*<Response><Message>TL20481742 was reported damaged/);
  assert.match(body, /alerted our support team \(ref ESC-/);
  assert.equal(sent.length, 1);
  assert.equal(sent[0][1].To, 'whatsapp:+15550100199');
  assert.match(sent[0][1].Body, /TrackLine escalation ESC-/);
  assert.equal((await twRoute.POST(req('bad'), { cfg })).status, 401);
});
