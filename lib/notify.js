// Escalation side effects: structured log line (always) + WhatsApp alert to ops (best effort).
import { opsAlertText, maskContact } from './escalation.js';
import { sendWhatsApp } from './whatsapp.js';
import { whatsappReady } from './config.js';

export function log(event, data) {
  // One JSON line per event: searchable in Vercel's runtime logs.
  console.log(JSON.stringify({ event, at: new Date().toISOString(), ...data }));
}

export async function raiseTickets(cfg, tickets, opts = {}) {
  const results = [];
  for (const t of tickets) {
    log('escalation', { ...t, contact: maskContact(t.contact) });
    let alert = { ok: false, skipped: 'ops number or WhatsApp not configured' };
    if (cfg.opsWhatsapp && whatsappReady(cfg)) {
      alert = await sendWhatsApp(cfg.whatsapp, cfg.opsWhatsapp, { type: 'text', text: { body: opsAlertText(t) } }, opts);
      // WhatsApp only allows free-form messages within 24h of the ops number last messaging the bot.
      if (!alert.ok) log('ops_alert_failed', { ticket_id: t.ticket_id, status: alert.status, error: alert.error });
    }
    results.push({ ticket_id: t.ticket_id, ops_alerted: Boolean(alert.ok) });
  }
  return results;
}
