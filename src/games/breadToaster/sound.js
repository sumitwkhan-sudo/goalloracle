/**
 * Bread-to-Toaster — tiny Web Audio sound engine.
 *
 * Sounds are synthesised with oscillators at runtime — no audio files to
 * load, so nothing can 404 or block the game. Browsers block audio until
 * a user gesture, so call resumeAudio() from the Start button / first tap.
 */

let ctx = null;
let muted = false;

function getCtx() {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { ctx = new AC(); } catch { return null; }
  }
  return ctx;
}

export function resumeAudio() {
  const c = getCtx();
  if (c && c.state === 'suspended') c.resume();
}

export function setMuted(m) { muted = m; }
export function isMuted() { return muted; }

// One enveloped beep, optionally sliding to another frequency.
function blip(freq, dur, type = 'square', vol = 0.18, slideTo = null) {
  if (muted) return;
  const c = getCtx();
  if (!c) return;
  const t0 = c.currentTime;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g);
  g.connect(c.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.03);
}

// Play a little sequence of notes, one after another.
function seq(notes) {
  let when = 0;
  for (const n of notes) {
    const delay = when;
    setTimeout(() => blip(n.f, n.d, n.type || 'square', n.vol || 0.18, n.slide || null), delay * 1000);
    when += n.gap != null ? n.gap : n.d;
  }
}

export const sfx = {
  start() { blip(440, 0.1, 'triangle', 0.15, 660); },
  jump() { blip(300, 0.13, 'square', 0.16, 560); },
  die() { blip(330, 0.34, 'sawtooth', 0.2, 70); },
  levelClear() { seq([{ f: 392, d: 0.12 }, { f: 523, d: 0.12 }, { f: 659, d: 0.22 }]); },
  win() { seq([{ f: 523, d: 0.12 }, { f: 659, d: 0.12 }, { f: 784, d: 0.12 }, { f: 1047, d: 0.3 }]); },
};
