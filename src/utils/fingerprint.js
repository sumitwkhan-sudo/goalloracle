// Lightweight DIY device fingerprint. Combines stable browser signals
// (canvas hash, screen size, timezone, language, hardware concurrency,
// user-agent platform) into a SHA-256 visitor ID.
//
// This is a deterrent against casual multi-accounting, NOT a hard identifier
// — fingerprints can be spoofed by a determined user, and Safari ITP randomises
// canvas output. Pair with IP rate-limits + email normalisation for layered
// defence. Stability target: same browser + device → same ID across sessions
// for ~70-80% of mainstream traffic.

let _cachedVisitorId = null;
let _inFlight = null;

function safe(fn, fallback = '') {
  try { return fn(); } catch { return fallback; }
}

function canvasHash() {
  if (typeof document === 'undefined') return '';
  return safe(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 220;
    canvas.height = 30;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    ctx.textBaseline = 'top';
    ctx.font = '14px "Arial"';
    ctx.fillStyle = '#f60';
    ctx.fillRect(125, 1, 62, 20);
    ctx.fillStyle = '#069';
    ctx.fillText('GoalOracle 🇧🇷⚽', 2, 15);
    ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
    ctx.fillText('GoalOracle 🇧🇷⚽', 4, 17);
    return canvas.toDataURL();
  });
}

async function sha256Hex(input) {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  // Fallback: not cryptographically strong but stable. Used only when SubtleCrypto
  // is unavailable (very old browsers).
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) - h) + input.charCodeAt(i);
    h |= 0;
  }
  return ('00000000' + (h >>> 0).toString(16)).slice(-8).repeat(8);
}

function collectSignals() {
  if (typeof navigator === 'undefined') return [];
  const screen = typeof window !== 'undefined' ? (window.screen || {}) : {};
  return [
    safe(() => navigator.userAgent),
    safe(() => navigator.language),
    safe(() => (navigator.languages || []).join(',')),
    safe(() => navigator.platform),
    safe(() => navigator.hardwareConcurrency),
    safe(() => navigator.deviceMemory),
    safe(() => screen.width),
    safe(() => screen.height),
    safe(() => screen.colorDepth),
    safe(() => screen.pixelDepth),
    safe(() => Intl.DateTimeFormat().resolvedOptions().timeZone),
    safe(() => new Date().getTimezoneOffset()),
    canvasHash(),
  ].map(v => String(v ?? ''));
}

const STORAGE_KEY = 'goaloracle_visitor_id';

export async function getVisitorId() {
  if (_cachedVisitorId) return _cachedVisitorId;
  if (_inFlight) return _inFlight;

  _inFlight = (async () => {
    // Persist across sessions so legitimate returning users hit the same ID
    // even when canvas/UA signals drift slightly.
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && /^[a-f0-9]{32,128}$/.test(stored)) {
        _cachedVisitorId = stored;
        return stored;
      }
    } catch {}

    const signals = collectSignals().join('|');
    const visitorId = await sha256Hex(signals);
    try { localStorage.setItem(STORAGE_KEY, visitorId); } catch {}
    _cachedVisitorId = visitorId;
    return visitorId;
  })();

  try {
    return await _inFlight;
  } finally {
    _inFlight = null;
  }
}
