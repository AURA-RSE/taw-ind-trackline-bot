// Seed shipment data (fictional) and tracking lookup.
// Dates are relative to "now" so the demo never goes stale.

const DAY = 24 * 60 * 60 * 1000;

// Status codes the courier system would emit. `exception` marks statuses that need a human.
export const STATUSES = {
  label_created: { label: 'Label created', exception: false },
  in_transit: { label: 'In transit', exception: false },
  out_for_delivery: { label: 'Out for delivery', exception: false },
  delivered: { label: 'Delivered', exception: false },
  delayed: { label: 'Delayed', exception: true },
  failed_attempt: { label: 'Delivery attempt failed', exception: true },
  held_at_hub: { label: 'Held at hub', exception: true },
  damaged: { label: 'Reported damaged', exception: true },
};

// offsetDays are relative to the moment of lookup.
const SEED = [
  { tracking: 'TL20481736', status: 'in_transit', origin: 'Lagos', destination: 'Abuja', lastScan: 'Ibadan sorting hub', lastScanOffsetH: -5, etaOffsetDays: 1, service: 'Standard', valueNgn: 18500 },
  { tracking: 'TL20481737', status: 'out_for_delivery', origin: 'Abuja', destination: 'Abuja', lastScan: 'Wuse delivery van', lastScanOffsetH: -1, etaOffsetDays: 0, service: 'Same day', valueNgn: 6200 },
  { tracking: 'TL20481738', status: 'delivered', origin: 'Port Harcourt', destination: 'Lagos', lastScan: 'Delivered, signed by recipient', lastScanOffsetH: -20, etaOffsetDays: -1, service: 'Express', valueNgn: 42000 },
  { tracking: 'TL20481739', status: 'delayed', origin: 'Kano', destination: 'Lagos', lastScan: 'Kaduna hub', lastScanOffsetH: -60, etaOffsetDays: 2, service: 'Standard', valueNgn: 9900, reason: 'Road closure on the Kaduna–Abuja route' },
  { tracking: 'TL20481740', status: 'failed_attempt', origin: 'Lagos', destination: 'Ibadan', lastScan: 'Bodija delivery van', lastScanOffsetH: -3, etaOffsetDays: 1, service: 'Standard', valueNgn: 15000, reason: 'Nobody available to receive the parcel', attempts: 2 },
  { tracking: 'TL20481741', status: 'held_at_hub', origin: 'Enugu', destination: 'Abuja', lastScan: 'Abuja central hub', lastScanOffsetH: -30, etaOffsetDays: null, service: 'Express', valueNgn: 250000, reason: 'Address could not be verified' },
  { tracking: 'TL20481742', status: 'damaged', origin: 'Lagos', destination: 'Port Harcourt', lastScan: 'Port Harcourt hub', lastScanOffsetH: -8, etaOffsetDays: null, service: 'Standard', valueNgn: 31000, reason: 'Outer packaging damaged in transit' },
  { tracking: 'TL20481743', status: 'label_created', origin: 'Abuja', destination: 'Kano', lastScan: 'Shipping label created, waiting for pickup', lastScanOffsetH: -2, etaOffsetDays: 3, service: 'Standard', valueNgn: 7400 },
];

export const HIGH_VALUE_NGN = 100000;

const NUMBER_WORDS = { zero: '0', oh: '0', o: '0', one: '1', two: '2', to: '2', too: '2', three: '3', four: '4', for: '4', five: '5', six: '6', seven: '7', eight: '8', ate: '8', nine: '9' };
const LETTER_WORDS = { tee: 'T', tea: 'T', t: 'T', el: 'L', ell: 'L', l: 'L' };

// Accepts what customers type ("tl-2048 1736") or what a voice transcriber hears
// ("T L two zero four eight one seven three six", "tee el 2048 1736", "double four").
export function normalizeTrackingNumber(input) {
  if (!input) return null;
  const words = String(input).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  let out = '';
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if ((w === 'double' || w === 'triple') && words[i + 1]) {
      const next = NUMBER_WORDS[words[i + 1]] ?? (/^\d$/.test(words[i + 1]) ? words[i + 1] : null);
      if (next) { out += next.repeat(w === 'double' ? 2 : 3); i++; continue; }
    }
    if (NUMBER_WORDS[w] !== undefined && !/^(o|to|too|for)$/.test(w)) { out += NUMBER_WORDS[w]; continue; }
    if (/^(o|to|too|for)$/.test(w) && out.length >= 2) { out += NUMBER_WORDS[w]; continue; }
    if (LETTER_WORDS[w] && out.length < 2) { out += LETTER_WORDS[w]; continue; }
    out += w.toUpperCase();
  }
  const m = out.match(/TL(\d{8})/);
  if (m) return 'TL' + m[1];
  const digits = out.match(/(?:^|[^0-9])(\d{8})(?![0-9])/);
  return digits ? 'TL' + digits[1] : null;
}

// Finds a tracking number inside free text ("where is TL20481736 pls").
export function extractTrackingNumber(text) {
  const t = String(text || '');
  const direct = t.toUpperCase().match(/T\s*L[\s-]*((?:\d[\s-]*){8})/);
  if (direct) return 'TL' + direct[1].replace(/\D/g, '');
  const bare = t.match(/(?:^|\D)(\d{4}[\s-]?\d{4})(?!\d)/);
  return bare ? 'TL' + bare[1].replace(/\D/g, '') : null;
}

function materialize(seed, now) {
  const at = (h) => new Date(now.getTime() + h * 60 * 60 * 1000);
  return {
    tracking: seed.tracking,
    status: seed.status,
    statusLabel: STATUSES[seed.status].label,
    exception: STATUSES[seed.status].exception,
    origin: seed.origin,
    destination: seed.destination,
    lastScan: seed.lastScan,
    lastScanAt: at(seed.lastScanOffsetH).toISOString(),
    eta: seed.etaOffsetDays === null ? null : new Date(now.getTime() + seed.etaOffsetDays * DAY).toISOString().slice(0, 10),
    service: seed.service,
    highValue: seed.valueNgn >= HIGH_VALUE_NGN,
    reason: seed.reason || null,
    attempts: seed.attempts || 0,
  };
}

export function findShipment(trackingNumber, now = new Date()) {
  const id = normalizeTrackingNumber(trackingNumber);
  if (!id) return { ok: false, error: 'invalid_format' };
  const seed = SEED.find((s) => s.tracking === id);
  if (!seed) return { ok: false, error: 'not_found', tracking: id };
  return { ok: true, shipment: materialize(seed, now) };
}

export function allTrackingNumbers() {
  return SEED.map((s) => s.tracking);
}

function friendlyDate(iso, timezone) {
  if (!iso) return null;
  return new Intl.DateTimeFormat('en-GB', { timeZone: timezone, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(iso + 'T12:00:00Z'));
}

function friendlyTime(iso, timezone) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: timezone, weekday: 'short', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso));
}

// Customer-facing summary. Deliberately excludes names, phone numbers and street addresses:
// anyone who has a tracking number can ask, so only city-level status is revealed.
export function describeShipment(s, { timezone = 'Africa/Lagos', voice = false } = {}) {
  const eta = friendlyDate(s.eta, timezone);
  const scan = friendlyTime(s.lastScanAt, timezone);
  const id = voice ? s.tracking.split('').join(' ') : s.tracking;
  const lines = {
    label_created: `${id} has a shipping label and is waiting for pickup in ${s.origin}. Expected delivery: ${eta}.`,
    in_transit: `${id} is on its way from ${s.origin} to ${s.destination}. Last scan: ${s.lastScan}, ${scan}. Expected delivery: ${eta}.`,
    out_for_delivery: `${id} is out for delivery in ${s.destination} today. Last scan: ${s.lastScan}, ${scan}.`,
    delivered: `${id} was delivered in ${s.destination}. ${s.lastScan}, ${scan}.`,
    delayed: `${id} is delayed: ${s.reason}. It was last scanned at ${s.lastScan}, ${scan}. New expected delivery: ${eta}.`,
    failed_attempt: `We tried to deliver ${id} ${s.attempts > 1 ? s.attempts + ' times' : ''} but could not: ${s.reason}. Next attempt: ${eta}.`.replace('  ', ' '),
    held_at_hub: `${id} is being held at ${s.lastScan}: ${s.reason}.`,
    damaged: `${id} was reported damaged at ${s.lastScan}: ${s.reason}.`,
  };
  return lines[s.status];
}
