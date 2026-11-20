// Public demo lookup used by the web page: GET /api/track?id=TL20481736
import { findShipment, describeShipment } from '../lib/shipments.js';
import { autoEscalationReason } from '../lib/escalation.js';

export async function GET(request) {
  const id = new URL(request.url).searchParams.get('id') || '';
  const found = findShipment(id);
  if (!found.ok) return Response.json({ ok: false, error: found.error, tracking: found.tracking || null }, { status: found.error === 'not_found' ? 404 : 400 });
  const s = found.shipment;
  return Response.json({ ok: true, tracking: s.tracking, status: s.status, status_label: s.statusLabel, exception: s.exception, escalates: Boolean(autoEscalationReason(s, new Date())), eta: s.eta, summary: describeShipment(s) });
}
