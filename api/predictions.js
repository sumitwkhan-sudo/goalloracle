import { db, corsHeaders, verifyAuth } from './_lib/firebase.js';
import { FieldValue } from 'firebase-admin/firestore';
import WORLD_CUP_MATCHES from '../src/data/matches.js';

// ─── Build a lock-time lookup: matchId → UTC kickoff timestamp ───
// Match times are stored in US Eastern Time (ET).
// During the World Cup (June–July), ET = UTC-4 (EDT).
// We lock predictions 5 minutes before kickoff.
const LOCK_BUFFER_MS = 5 * 60 * 1000; // 5 minutes

const matchKickoffUTC = {};
WORLD_CUP_MATCHES.forEach(m => {
  // m.date = '2026-06-13', m.time = '15:00' (ET)
  // ET during summer = UTC-4, so 15:00 ET = 19:00 UTC
  const [hh, mm] = m.time.split(':').map(Number);
  const utcHour = hh + 4; // EDT offset: +4 hours to get UTC
  // Handle day rollover (e.g., 22:00 ET = 02:00 UTC next day)
  const date = new Date(`${m.date}T00:00:00Z`);
  date.setUTCHours(utcHour, mm, 0, 0);
  matchKickoffUTC[m.id] = date.getTime();
});

function isMatchLocked(matchId) {
  const kickoff = matchKickoffUTC[matchId];
  if (!kickoff) return false; // Unknown match ID — allow (shouldn't happen)
  return Date.now() >= kickoff - LOCK_BUFFER_MS;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).json({});
  Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));

  // GET: get predictions or leaderboard (public for leaderboard)
  if (req.method === 'GET') {
    const { type, userId, leagueId } = req.query;

    try {
      if (type === 'leaderboard' && leagueId) {
        const snap = await db.collection('predictions').where('leagueId', '==', leagueId).get();
        const byUser = {};
        snap.docs.forEach(d => {
          const data = d.data();
          if (!byUser[data.userId]) byUser[data.userId] = {};
          byUser[data.userId][data.matchId] = data;
        });

        // Fetch display names for all users in the leaderboard
        const userIds = Object.keys(byUser);
        const userNames = {};
        // Firestore 'in' queries max 30 per batch
        for (let i = 0; i < userIds.length; i += 30) {
          const batch = userIds.slice(i, i + 30);
          const usersSnap = await db.collection('users').where('id', 'in', batch).get();
          usersSnap.docs.forEach(d => {
            const u = d.data();
            userNames[d.id] = u.displayName || u.email?.split('@')[0] || d.id.slice(0, 8);
          });
        }
        // Fill in any missing names
        userIds.forEach(uid => { if (!userNames[uid]) userNames[uid] = uid.slice(0, 8); });

        return res.status(200).json({ leaderboard: byUser, userNames });

      } else if (type === 'user' && userId && leagueId) {
        const snap = await db.collection('predictions')
          .where('userId', '==', userId)
          .where('leagueId', '==', leagueId)
          .get();
        const preds = {};
        snap.docs.forEach(d => { const data = d.data(); preds[data.matchId] = data; });
        return res.status(200).json({ predictions: preds });
      }

      return res.status(400).json({ error: 'Invalid query params' });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // POST: save predictions (authenticated)
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const claims = await verifyAuth(req);
  if (!claims) return res.status(401).json({ error: 'Unauthorized' });

  const userId = claims.userId;
  const { leagueId, predictions } = req.body;

  if (!leagueId || !predictions) return res.status(400).json({ error: 'Missing leagueId or predictions' });

  // Verify user is a member of this league
  const leagueSnap = await db.collection('leagues').doc(leagueId).get();
  if (!leagueSnap.exists) return res.status(404).json({ error: 'League not found' });
  if (!leagueSnap.data().members?.includes(userId)) return res.status(403).json({ error: 'Not a member of this league' });

  try {
    const batch = db.batch();
    let count = 0;
    const locked = [];

    for (const [matchId, pred] of Object.entries(predictions)) {
      if (!pred.result) continue;

      // Server-side lock: reject predictions for matches that have kicked off (or within 5 min)
      if (isMatchLocked(matchId)) {
        locked.push(matchId);
        continue; // Skip this match — don't save, don't error the whole batch
      }

      const ref = db.collection('predictions').doc(`${userId}_${leagueId}_${matchId}`);
      batch.set(ref, {
        userId,
        leagueId,
        matchId,
        result: pred.result,
        score: { home: pred.score?.home || '', away: pred.score?.away || '' },
        extraTime: pred.extraTime || false,
        penalties: pred.penalties || false,
        updatedAt: FieldValue.serverTimestamp(),
        submittedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      count++;
    }

    await batch.commit();
    return res.status(200).json({ saved: count, locked: locked.length > 0 ? locked : undefined });
  } catch (e) {
    console.error('Save predictions error:', e);
    return res.status(500).json({ error: e.message });
  }
}
