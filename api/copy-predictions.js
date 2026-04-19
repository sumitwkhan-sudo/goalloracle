import { db, corsHeaders, verifyAuth } from './_lib/firebase.js';
import { FieldValue } from 'firebase-admin/firestore';
import WORLD_CUP_MATCHES from '../src/data/matches.js';

const LOCK_BUFFER_MS = 5 * 60 * 1000;
const matchKickoffUTC = {};
WORLD_CUP_MATCHES.forEach((m) => {
  const [hh, mm] = m.time.split(':').map(Number);
  const date = new Date(`${m.date}T00:00:00Z`);
  date.setUTCHours(hh + 4, mm, 0, 0); // EDT offset
  matchKickoffUTC[m.id] = date.getTime();
});
function isMatchLocked(matchId) {
  const kickoff = matchKickoffUTC[matchId];
  if (!kickoff) return false;
  return Date.now() >= kickoff - LOCK_BUFFER_MS;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(200).json({});
  }
  Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const claims = await verifyAuth(req);
  if (!claims) return res.status(401).json({ error: 'Unauthorized' });
  const userId = claims.userId;

  const { sourceLeagueId, targetLeagueId } = req.body || {};
  if (!sourceLeagueId || !targetLeagueId) {
    return res.status(400).json({ error: 'sourceLeagueId and targetLeagueId required' });
  }
  if (sourceLeagueId === targetLeagueId) {
    return res.status(400).json({ error: 'Source and target must differ' });
  }

  try {
    const [srcSnap, tgtSnap] = await Promise.all([
      db.collection('leagues').doc(sourceLeagueId).get(),
      db.collection('leagues').doc(targetLeagueId).get(),
    ]);
    if (!srcSnap.exists) return res.status(404).json({ error: 'Source league not found' });
    if (!tgtSnap.exists) return res.status(404).json({ error: 'Target league not found' });

    const src = srcSnap.data();
    const tgt = tgtSnap.data();

    // Both must be classic mode (simple predictions are already user-scoped)
    if (src.predictionMode === 'simple' || tgt.predictionMode === 'simple') {
      return res.status(400).json({
        error: 'Copy only applies to classic leagues. Simple Mode picks already apply to every simple league you join.',
      });
    }

    // User must be a member of the target league
    if (!tgt.members?.includes(userId)) {
      return res.status(403).json({ error: 'Not a member of the target league' });
    }

    // Read the user's predictions in the source league
    const predsSnap = await db
      .collection('predictions')
      .where('userId', '==', userId)
      .where('leagueId', '==', sourceLeagueId)
      .get();

    if (predsSnap.empty) {
      return res.status(200).json({ copied: 0, skippedLocked: 0, note: 'No predictions to copy' });
    }

    // Batch copy into target league — skip matches already locked and matches
    // that already have a prediction in the target (don't clobber existing picks).
    const existingTargetSnap = await db
      .collection('predictions')
      .where('userId', '==', userId)
      .where('leagueId', '==', targetLeagueId)
      .get();
    const existingMatchIds = new Set(existingTargetSnap.docs.map((d) => d.data().matchId));

    const batches = [];
    let batch = db.batch();
    let inBatch = 0;
    let copied = 0;
    let skippedLocked = 0;
    let skippedExisting = 0;

    for (const doc of predsSnap.docs) {
      const p = doc.data();
      const matchId = p.matchId;
      if (!matchId || !p.result) continue;
      if (isMatchLocked(matchId)) {
        skippedLocked += 1;
        continue;
      }
      if (existingMatchIds.has(matchId)) {
        skippedExisting += 1;
        continue;
      }
      const ref = db.collection('predictions').doc(`${userId}_${targetLeagueId}_${matchId}`);
      batch.set(
        ref,
        {
          userId,
          leagueId: targetLeagueId,
          matchId,
          result: p.result,
          score: { home: p.score?.home || '', away: p.score?.away || '' },
          extraTime: !!p.extraTime,
          penalties: !!p.penalties,
          copiedFrom: sourceLeagueId,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          submittedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      copied += 1;
      inBatch += 1;
      if (inBatch >= 450) {
        batches.push(batch.commit());
        batch = db.batch();
        inBatch = 0;
      }
    }
    if (inBatch > 0) batches.push(batch.commit());
    await Promise.all(batches);

    return res.status(200).json({ copied, skippedLocked, skippedExisting });
  } catch (e) {
    console.error('[copy-predictions] Error:', e);
    return res.status(500).json({ error: e.message });
  }
}
