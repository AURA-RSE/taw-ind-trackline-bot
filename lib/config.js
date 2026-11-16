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
  };
}

export function whatsappReady(cfg) {
  return Boolean(cfg.whatsapp.token && cfg.whatsapp.phoneNumberId);
}
