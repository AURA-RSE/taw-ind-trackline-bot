// Builds vapi/assistant.json and vapi/tools/*.json. {{PLACEHOLDERS}} are filled by scripts/setup-vapi.js.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ISSUES } from '../lib/escalation.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = { url: '{{VAPI_SERVER_URL}}', timeoutSeconds: 20, headers: { 'X-Vapi-Secret': '{{VAPI_SHARED_SECRET}}' } };
const tools = {
  'lookup-shipment.json': {
    type: 'function',
    function: {
      name: 'lookup_shipment',
      description: 'Look up a TrackLine shipment by tracking number. Returns a status summary to read out, and a ticket_id if the shipment was escalated automatically.',
      parameters: { type: 'object', properties: { tracking_number: { type: 'string', description: 'Tracking number exactly as the caller said it, e.g. "T L 2 0 4 8 1 7 3 6"' } }, required: ['tracking_number'] },
    },
    server,
    messages: [{ type: 'request-start', content: 'Let me check that for you.' }, { type: 'request-failed', role: 'system', content: 'The lookup failed. Apologise and offer to transfer the caller to a person.' }],
  },
  'report-problem.json': {
    type: 'function',
    function: {
      name: 'report_problem',
      description: 'Open a support ticket for a delivery problem and alert the operations team. Returns a ticket reference to read to the caller.',
      parameters: {
        type: 'object',
        properties: {
          tracking_number: { type: 'string' },
          issue: { type: 'string', enum: Object.keys(ISSUES) },
          details: { type: 'string', description: 'One sentence in the caller\'s words' },
        },
        required: ['tracking_number', 'issue'],
      },
    },
    server,
    messages: [{ type: 'request-failed', role: 'system', content: 'The ticket could not be created. Apologise and transfer the caller to a person.' }],
  },
  'transfer-to-ops.json': {
    type: 'transferCall',
    destinations: [{ type: 'number', number: '{{OPS_PHONE_NUMBER}}', message: 'Connecting you to our support team now. Please hold.', description: 'TrackLine support team (human). Use when the caller asks for a person, is upset, or the assistant cannot help.', transferPlan: { mode: 'blind-transfer' } }],
    messages: [{ type: 'request-failed', role: 'system', content: 'The transfer failed. Apologise, and use report_problem so the team calls them back.' }],
  },
  'end-call.json': { type: 'endCall' },
};
const assistant = {
  name: 'TrackLine Bot',
  firstMessage: 'Hi, thanks for calling TrackLine Express. I can tell you where your parcel is or help with a delivery problem. What is your tracking number?',
  model: { provider: 'openai', model: '{{OPENAI_MODEL}}', temperature: 0.2, messages: [{ role: 'system', content: fs.readFileSync(path.join(root, 'vapi', 'system-prompt.md'), 'utf8') }], toolIds: ['{{TOOL_ID_lookup_shipment}}', '{{TOOL_ID_report_problem}}', '{{TOOL_ID_transferCall}}', '{{TOOL_ID_endCall}}'] },
  voice: { provider: 'vapi', voiceId: 'Elliot' },
  transcriber: { provider: 'deepgram', model: 'nova-2', language: 'en' },
  maxDurationSeconds: 420,
  server,
  serverMessages: ['end-of-call-report'],
  analysisPlan: { summaryPlan: { enabled: true }, structuredDataPlan: { enabled: true, schema: { type: 'object', properties: { tracking_number: { type: 'string' }, outcome: { type: 'string', enum: ['status_given', 'ticket_created', 'transferred', 'not_found', 'abandoned'] } } } } },
};
fs.mkdirSync(path.join(root, 'vapi', 'tools'), { recursive: true });
for (const [f, d] of Object.entries(tools)) fs.writeFileSync(path.join(root, 'vapi', 'tools', f), JSON.stringify(d, null, 2) + '\n');
fs.writeFileSync(path.join(root, 'vapi', 'assistant.json'), JSON.stringify(assistant, null, 2) + '\n');
console.log('Wrote vapi/assistant.json and', Object.keys(tools).length, 'tools');
