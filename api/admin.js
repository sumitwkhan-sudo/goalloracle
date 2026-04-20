import { db, corsHeaders, verifyAuth } from './_lib/firebase.js';
import { FieldValue } from 'firebase-admin/firestore';

async function isAdmin(userId) {
  const userSnap = await db.collection('users').doc(userId).get();
  if (!userSnap.exists) return false;
  const role = userSnap.data().role;
  return role === 'admin' || role === 'superadmin';
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v)); return res.status(200).json({}); }
  Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));

  const claims = await verifyAuth(req);
  if (!claims) return res.status(401).json({ error: 'Unauthorized' });

  const userId = claims.userId;
  if (!(await isAdmin(userId))) return res.status(403).json({ error: 'Admin access required' });

  // GET: list match results or users
  if (req.method === 'GET') {
    const { type } = req.query;
    try {
      if (type === 'results') {
        const snap = await db.collection('matchResults').get();
        const results = {};
        snap.docs.forEach(d => { results[d.id] = d.data(); });
        return res.status(200).json({ results });
      } else if (type === 'users') {
        const snap = await db.collection('users').get();
        return res.status(200).json({ users: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
      }
      return res.status(400).json({ error: 'Invalid type' });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action } = req.body;

  try {
    if (action === 'updateResult') {
      const { matchId, homeScore, awayScore, extraTime, penalties } = req.body;
      if (!matchId || homeScore === undefined || awayScore === undefined) {
        return res.status(400).json({ error: 'Missing match data' });
      }

      await db.collection('matchResults').doc(matchId).set({
        matchId,
        homeScore: parseInt(homeScore),
        awayScore: parseInt(awayScore),
        extraTime: extraTime || false,
        penalties: penalties || false,
        completed: true,
        updatedBy: userId,
        updatedAt: FieldValue.serverTimestamp(),
      });

      // Log admin action
      await db.collection('adminLogs').add({
        action: 'update_match_result',
        matchId,
        result: { homeScore, awayScore, extraTime, penalties },
        adminId: userId,
        timestamp: FieldValue.serverTimestamp(),
      });

      return res.status(200).json({ success: true });

    } else if (action === 'setRole') {
      const { targetUserId, newRole } = req.body;
      if (!targetUserId || !newRole) return res.status(400).json({ error: 'Missing user/role' });
      if (!['user', 'admin', 'superadmin'].includes(newRole)) return res.status(400).json({ error: 'Invalid role' });

      await db.collection('users').doc(targetUserId).update({ role: newRole });
      await db.collection('adminLogs').add({
        action: 'set_user_role',
        targetUserId,
        newRole,
        adminId: userId,
        timestamp: FieldValue.serverTimestamp(),
      });

      return res.status(200).json({ success: true });

    } else if (action === 'deleteLeague') {
      const { leagueId } = req.body;
      if (!leagueId) return res.status(400).json({ error: 'Missing leagueId' });
      if (leagueId === 'global') return res.status(400).json({ error: 'Cannot delete the global league' });

      const leagueSnap = await db.collection('leagues').doc(leagueId).get();
      if (!leagueSnap.exists) return res.status(404).json({ error: 'League not found' });

      const league = leagueSnap.data();
      await db.collection('leagues').doc(leagueId).delete();

      await db.collection('adminLogs').add({
        action: 'delete_league',
        leagueId,
        leagueName: league.name,
        adminId: userId,
        timestamp: FieldValue.serverTimestamp(),
      });

      // Cleanup: remove league from member docs + delete predictions
      const memberIds = league.members || [];
      const cleanupPromises = memberIds.map(mid =>
        db.collection('users').doc(mid).update({ leagues: FieldValue.arrayRemove(leagueId) }).catch(() => {})
      );

      const predSnap = await db.collection('predictions').where('leagueId', '==', leagueId).get();
      const docs = predSnap.docs;
      for (let i = 0; i < docs.length; i += 500) {
        const batch = db.batch();
        docs.slice(i, i + 500).forEach(d => batch.delete(d.ref));
        cleanupPromises.push(batch.commit());
      }

      await Promise.all(cleanupPromises);

      return res.status(200).json({ success: true, deleted: leagueId });
    }

    if (action === 'renameLeague') {
      const { leagueId, name } = req.body;
      if (!leagueId) return res.status(400).json({ error: 'Missing leagueId' });
      const trimmed = (name || '').trim();
      if (!trimmed) return res.status(400).json({ error: 'Name is required' });
      if (trimmed.length > 60) return res.status(400).json({ error: 'Name too long (max 60 chars)' });

      const leagueSnap = await db.collection('leagues').doc(leagueId).get();
      if (!leagueSnap.exists) return res.status(404).json({ error: 'League not found' });
      const prevName = leagueSnap.data().name || null;
      if (prevName === trimmed) return res.status(200).json({ success: true, name: trimmed, unchanged: true });

      await db.collection('leagues').doc(leagueId).update({ name: trimmed });
      await db.collection('adminLogs').add({
        action: 'rename_league',
        leagueId,
        previousName: prevName,
        newName: trimmed,
        adminId: userId,
        timestamp: FieldValue.serverTimestamp(),
      });

      return res.status(200).json({ success: true, name: trimmed });
    }

    if (action === 'backfillCountries') {
      // One-shot: walk every user and assign a country if they don't have
      // one. Product-directed override map wins; everyone else defaults to
      // US (we can't geolocate server-side per-user after the fact).
      const OVERRIDES = { 'lebida2352': 'PK', 'Sumit': 'BD' };
      const usersSnap = await db.collection('users').get();
      let updated = 0;
      let skipped = 0;
      const overrideHits = [];
      const docs = usersSnap.docs;
      for (let i = 0; i < docs.length; i += 400) {
        const batch = db.batch();
        let batchCount = 0;
        docs.slice(i, i + 400).forEach(d => {
          const u = d.data();
          if (u.country) { skipped++; return; }
          const override = OVERRIDES[u.displayName];
          const country = override || 'US';
          if (override) overrideHits.push({ displayName: u.displayName, country });
          batch.update(d.ref, { country });
          batchCount++;
        });
        if (batchCount > 0) {
          await batch.commit();
          updated += batchCount;
        }
      }
      await db.collection('adminLogs').add({
        action: 'backfill_countries',
        adminId: userId,
        updated,
        skipped,
        overrides: overrideHits,
        timestamp: FieldValue.serverTimestamp(),
      });
      return res.status(200).json({ success: true, updated, skipped, overrides: overrideHits });
    }

    return res.status(400).json({ error: 'Invalid action' });
  } catch (e) {
    console.error('Admin error:', e);
    return res.status(500).json({ error: e.message });
  }
}
