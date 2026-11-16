// Sends a WhatsApp message through Twilio (used for ops alerts when the Meta Cloud API isn't configured).
export async function sendTwilioWhatsApp(cfg, to, body, { fetchImpl = fetch, retries = 3, baseDelayMs = 500 } = {}) {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${cfg.accountSid}/Messages.json`;
  const form = new URLSearchParams({ From: `whatsapp:${cfg.from.replace(/^whatsapp:/, '')}`, To: `whatsapp:+${String(to).replace(/^\+/, '')}`, Body: body });
  const auth = 'Basic ' + Buffer.from(`${cfg.accountSid}:${cfg.authToken}`).toString('base64');
  let last = null;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetchImpl(url, { method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' }, body: form });
      if (res.ok) return { ok: true, status: res.status, attempts: attempt };
      last = { ok: false, status: res.status, error: (await res.text().catch(() => '')).slice(0, 300), attempts: attempt };
      if (res.status !== 429 && res.status < 500) return last;
    } catch (e) {
      last = { ok: false, status: 0, error: String(e && e.message), attempts: attempt };
    }
    if (attempt < retries) await new Promise((r) => setTimeout(r, baseDelayMs * 2 ** (attempt - 1)));
  }
  return last;
}
