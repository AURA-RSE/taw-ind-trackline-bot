import { loadConfig, whatsappReady } from '../lib/config.js';
export async function GET() {
  const cfg = loadConfig();
  return Response.json({ ok: true, whatsapp_configured: whatsappReady(cfg), twilio_configured: Boolean(cfg.twilio.accountSid && cfg.twilio.authToken && cfg.twilio.from), ops_alerts_configured: Boolean(cfg.opsWhatsapp), vapi_secret_set: Boolean(cfg.vapiSecret) });
}
