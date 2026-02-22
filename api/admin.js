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
    }

    return res.status(400).json({ error: 'Invalid action' });
  } catch (e) {
    console.error('Admin error:', e);
    return res.status(500).json({ error: e.message });
  }
}
