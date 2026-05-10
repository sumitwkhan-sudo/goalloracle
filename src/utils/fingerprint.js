// Open-source FingerprintJS (MIT). Combines ~50 stable browser/device
// signals into a visitor ID. Much harder to spoof than the DIY canvas hash
// it replaced, but still a deterrent — not a hard identifier. Privacy-mode
// browsers (Safari ITP, Firefox strict) randomise some signals; expect
// ~70-80% stability for mainstream traffic.
//
// We cache the result in localStorage so a returning user hits the same ID
// even if signals drift slightly between visits. If the user clears storage
// the next call recomputes from scratch — but FingerprintJS-derived IDs
// are themselves deterministic from the device, so the same browser on the
// same machine produces the same ID without needing the cache.

import FingerprintJS from '@fingerprintjs/fingerprintjs';

let _cachedVisitorId = null;
let _inFlight = null;

const STORAGE_KEY = 'goaloracle_visitor_id';
const VALID_ID_RE = /^[A-Za-z0-9_-]{8,128}$/;

export async function getVisitorId() {
  if (_cachedVisitorId) return _cachedVisitorId;
  if (_inFlight) return _inFlight;

  _inFlight = (async () => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && VALID_ID_RE.test(stored)) {
        _cachedVisitorId = stored;
        return stored;
      }
    } catch {}

    const fp = await FingerprintJS.load({ monitoring: false });
    const result = await fp.get();
    const visitorId = result.visitorId;
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
