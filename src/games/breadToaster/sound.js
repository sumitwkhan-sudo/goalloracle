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

export function setMuted(m) {
  muted = m;
  if (musicGain) musicGain.gain.value = m ? 0 : MUSIC_VOL;
}
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

// ---------------------------------------------------------------------------
// Background music — a light, looping chiptune bounced through a master gain
// so it can be muted without touching the SFX. Notes are scheduled against
// the audio clock with a small lookahead for steady timing.
// ---------------------------------------------------------------------------
const MUSIC_VOL = 0.5;
const STEP_DUR = 0.18; // seconds per 1/8 note (~bouncy tempo)
// 16-step cheerful melody (C major) + a root bassline underneath.
const MELODY = [523, 659, 784, 659, 587, 784, 1047, 784, 523, 659, 784, 880, 784, 659, 587, 0];
const BASS = [131, 0, 196, 0, 220, 0, 175, 0, 131, 0, 196, 0, 220, 0, 175, 0];

let musicGain = null;
let musicTimer = null;
let musicStep = 0;
let nextNoteTime = 0;

function musicNote(time, freq, dur, type, vol) {
  const c = getCtx();
  if (!c || !musicGain) return;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, time);
  g.gain.setValueAtTime(0.0001, time);
  g.gain.exponentialRampToValueAtTime(vol, time + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
  o.connect(g);
  g.connect(musicGain);
  o.start(time);
  o.stop(time + dur + 0.03);
}

function musicScheduler() {
  const c = getCtx();
  if (!c) return;
  while (nextNoteTime < c.currentTime + 0.12) {
    const m = MELODY[musicStep % MELODY.length];
    if (m) musicNote(nextNoteTime, m, STEP_DUR * 0.9, 'triangle', 0.13);
    const b = BASS[musicStep % BASS.length];
    if (b) musicNote(nextNoteTime, b, STEP_DUR * 1.7, 'sine', 0.18);
    nextNoteTime += STEP_DUR;
    musicStep += 1;
  }
}

export function startMusic() {
  const c = getCtx();
  if (!c) return;
  if (!musicGain) {
    musicGain = c.createGain();
    musicGain.gain.value = muted ? 0 : MUSIC_VOL;
    musicGain.connect(c.destination);
  }
  if (musicTimer) return; // already playing
  musicStep = 0;
  nextNoteTime = c.currentTime + 0.1;
  musicScheduler();
  musicTimer = setInterval(musicScheduler, 25);
}

export function stopMusic() {
  if (musicTimer) { clearInterval(musicTimer); musicTimer = null; }
}
