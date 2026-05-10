/**
 * DailyCheckIn.jsx — pre-tournament daily streak loop.
 *
 * Real prediction streaks don't start until the tournament kicks off
 * (June 11, 2026). For the 4-week pre-tournament window we surface a
 * tiny tap-to-confirm "checked in today" button — increments a local
 * streak counter so users have a reason to come back daily.
 *
 * Persisted in localStorage only (no Firestore writes). Cheap to ship,
 * cheap to remove. Once kickoff arrives the component hides itself and
 * the real per-match streak surface (Dashboard td-resultsblock) takes
 * over.
 *
 * Storage shape:
 *   key: `goaloracle_checkin:${userId}`
 *   value: { streak: number, lastDay: 'YYYY-MM-DD' }
 */

import React, { useEffect, useState } from 'react';
import { Flame, CheckCircle } from 'lucide-react';
import { STAGE_FIRST_KICKOFF_UTC } from '../../utils/stageLock';

function todayKey() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function loadState(userId) {
  try {
    const raw = localStorage.getItem(`goaloracle_checkin:${userId}`);
    if (!raw) return { streak: 0, lastDay: null };
    return JSON.parse(raw);
  } catch {
    return { streak: 0, lastDay: null };
  }
}

function saveState(userId, state) {
  try {
    localStorage.setItem(`goaloracle_checkin:${userId}`, JSON.stringify(state));
  } catch {}
}

function dayDelta(prev, curr) {
  // Number of UTC calendar days between two YYYY-MM-DD strings. Returns
  // -1 if prev is null / unparseable.
  if (!prev) return -1;
  const a = Date.UTC(...prev.split('-').map((s, i) => i === 1 ? Number(s) - 1 : Number(s)));
  const b = Date.UTC(...curr.split('-').map((s, i) => i === 1 ? Number(s) - 1 : Number(s)));
  return Math.round((b - a) / 86400000);
}

export default function DailyCheckIn({ userId }) {
  const [state, setState] = useState({ streak: 0, lastDay: null });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!userId) return;
    setState(loadState(userId));
    setLoaded(true);
  }, [userId]);

  // Hide once the tournament has actually started — real match streaks
  // are more meaningful than a tap-button counter.
  if (Date.now() >= STAGE_FIRST_KICKOFF_UTC) return null;
  if (!userId || !loaded) return null;

  const today = todayKey();
  const checkedInToday = state.lastDay === today;

  const handleCheckIn = () => {
    if (checkedInToday) return;
    const delta = dayDelta(state.lastDay, today);
    const nextStreak = delta === 1 ? state.streak + 1 : 1;
    const next = { streak: nextStreak, lastDay: today };
    setState(next);
    saveState(userId, next);
  };

  return (
    <div className={`dash-checkin ${checkedInToday ? 'is-checked' : ''}`}>
      <div className="dash-checkin-icon" aria-hidden="true">
        {checkedInToday ? <CheckCircle size={16} /> : <Flame size={16} />}
      </div>
      <div className="dash-checkin-body">
        <div className="dash-checkin-title">
          {checkedInToday ? 'Checked in today' : 'Daily check-in'}
        </div>
        <div className="dash-checkin-sub">
          {checkedInToday
            ? <>Come back tomorrow to extend your streak.</>
            : <>Stay sharp until kickoff — tap to keep your streak alive.</>}
        </div>
      </div>
      <div className="dash-checkin-streak" aria-label={`Current streak: ${state.streak} days`}>
        <span className="dash-checkin-streak-num">{state.streak}</span>
        <span className="dash-checkin-streak-label">day{state.streak === 1 ? '' : 's'}</span>
      </div>
      {!checkedInToday && (
        <button type="button" className="dash-checkin-cta" onClick={handleCheckIn}>
          Check in
        </button>
      )}
    </div>
  );
}
