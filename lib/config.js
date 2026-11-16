// All settings come from environment variables (see .env.example). Nothing secret is hard-coded.
export function loadConfig(env = process.env) {
  return {
    timezone: env.TIMEZONE || 'Africa/Lagos',
    whatsapp: {
      token: env.WHATSAPP_TOKEN || '',
      phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID || '',
      verifyToken: env.WHATSAPP_VERIFY_TOKEN || '',
      appSecret: env.WHATSAPP_APP_SECRET || '',
      graphVersion: env.GRAPH_API_VERSION || 'v21.0',
    },
    // Ops team WhatsApp number for escalation alerts (test number / opted-in only).
    opsWhatsapp: (env.OPS_WHATSAPP_NUMBER || '').replace(/[^0-9]/g, ''),
    vapiSecret: env.VAPI_SHARED_SECRET || '',
    // Twilio WhatsApp (free sandbox): only the auth token is needed, to validate webhook signatures
    // and to send ops alerts through Twilio when Meta isn't configured.
    twilio: { accountSid: env.TWILIO_ACCOUNT_SID || '', authToken: env.TWILIO_AUTH_TOKEN || '', from: env.TWILIO_WHATSAPP_FROM || '' },
    publicBaseUrl: env.PUBLIC_BASE_URL || '',
  };
}

export function whatsappReady(cfg) {
  return Boolean(cfg.whatsapp.token && cfg.whatsapp.phoneNumberId);
}
